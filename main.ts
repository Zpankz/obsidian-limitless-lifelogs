import { App, Plugin, PluginSettingTab, Setting, normalizePath, Notice, requestUrl, Modal, ButtonComponent } from 'obsidian';

// Remember to rename these classes and interfaces!

interface Chat {
	id: string;
	summary?: string;
	createdAt: string;
	startedAt: string;
	messages: ChatMessage[];
	visibility: 'private' | 'public' | 'internal';
}

interface ChatMessage {
	id: string;
	text?: string;
	toolCalls?: ToolCall[];
	toolResults?: ToolResult[];
	createdAt: string;
	user: {
		role: 'user' | 'assistant' | 'system' | 'tool';
		name?: string;
	};
}

interface ToolCall {
	id: string;
	toolName: string;
	args?: Record<string, unknown>;
}

interface ToolResult {
	result: unknown;
	isError: boolean;
	toolCallId: string;
	toolName: string;
	entriesReturned?: Array<{
		title: string;
		id: string;
	}>;
}

interface LimitlessLifelogsSettings {
	apiKey: string;
	folderPath: string;
	startDate: string;
	// Chat settings
	chatFolderPath: string;
	syncChats: boolean;
	chatFileFormat: 'daily' | 'per-chat' | 'monthly';
	maxChatsPerSync: number;
	// New settings
	createCheckboxAggregation: boolean;
	checkboxAggregationFile: string;
}

const DEFAULT_SETTINGS: LimitlessLifelogsSettings = {
	apiKey: '',
	folderPath: 'Limitless Lifelogs',
	startDate: '2025-02-09',
	// Chat defaults
	chatFolderPath: 'Limitless Chats',
	syncChats: false,
	chatFileFormat: 'per-chat',
	maxChatsPerSync: 50,
	// New defaults
	createCheckboxAggregation: true,
	checkboxAggregationFile: 'Todo Aggregation.md'
}

export default class LimitlessLifelogsPlugin extends Plugin {
	settings: LimitlessLifelogsSettings;
	api: LimitlessAPI;

	async onload() {
		await this.loadSettings();
		this.api = new LimitlessAPI(this.settings.apiKey);

		// Add settings tab
		this.addSettingTab(new LimitlessLifelogsSettingTab(this.app, this));

		// Add ribbon icon for syncing
		this.addRibbonIcon('sync', 'Sync Limitless Data', async (evt: MouseEvent) => {
			if (evt.ctrlKey || evt.metaKey) {
				// Ctrl/Cmd + Click for chats only
				new UnifiedSyncModal(this.app, this).open();
			} else if (evt.shiftKey) {
				// Shift + Click for both
				await this.syncLifelogs();
				new UnifiedSyncModal(this.app, this).open();
			} else {
				// Default: lifelogs only
				await this.syncLifelogs();
			}
		});

		// Add commands for syncing
		this.addCommand({
			id: 'sync-limitless-lifelogs',
			name: 'Sync Lifelogs',
			callback: async () => {
				await this.syncLifelogs();
			}
		});

		this.addCommand({
			id: 'sync-limitless-chats',
			name: 'Sync Chats',
			callback: async () => {
				new UnifiedSyncModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'sync-all-limitless',
			name: 'Sync All (Lifelogs + Chats)',
			callback: async () => {
				await this.syncLifelogs();
				new UnifiedSyncModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'select-chats-to-sync',
			name: 'Select Chats to Sync',
			callback: () => {
				new UnifiedSyncModal(this.app, this).open();
			}
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.api) {
			this.api.setApiKey(this.settings.apiKey);
		}
	}

	async syncLifelogs() {
		if (!this.settings.apiKey) {
			new Notice('Please set your Limitless API key in settings');
			return;
		}

		try {
			// Ensure the folder exists
			const folderPath = normalizePath(this.settings.folderPath);
			await this.ensureFolderExists(folderPath);

			// Get the last synced date
			const lastSyncedDate = await this.getLastSyncedDate();
			const startDate = lastSyncedDate || new Date(this.settings.startDate);
			const endDate = new Date();

			new Notice('Starting Limitless lifelog sync...');

			const currentDate = new Date(startDate);
			while (currentDate <= endDate) {
				const dateStr = currentDate.toISOString().split('T')[0];
				const logs = await this.api.getLifelogs(currentDate);

				if (logs && logs.length > 0) {
					const content = logs.map(log => this.formatLifelogMarkdown(log as {
						markdown?: string; 
						title?: string; 
						contents?: Array<{
							type: string; 
							content: string; 
							speakerName?: string; 
							startTime?: string;
						}>
					})).join('\n\n');
					const filePath = `${folderPath}/${dateStr}.md`;
					await this.app.vault.adapter.write(filePath, content);
					new Notice(`Synced entries for ${dateStr}`);
				}

				currentDate.setDate(currentDate.getDate() + 1);
			}

			new Notice('Limitless lifelog sync complete!');
		} catch (error) {
			console.error('Error syncing lifelogs:', error);
			new Notice('Error syncing Limitless lifelogs. Check console for details.');
		}
	}

	private async ensureFolderExists(path: string) {
		const folder = this.app.vault.getFolderByPath(path);
		if (!folder) {
			await this.app.vault.createFolder(path);
		}
	}

	private async getLastSyncedDate(): Promise<Date | null> {
		const folderPath = normalizePath(this.settings.folderPath);
		try {
			const files = this.app.vault.getFiles()
				.filter(file => file.path.startsWith(folderPath + '/'))
				.filter(file => file.path.endsWith('.md'))
				.map(file => file.basename)
				.filter(basename => /^\d{4}-\d{2}-\d{2}$/.test(basename))
				.map(basename => new Date(basename))
				.sort((a, b) => b.getTime() - a.getTime());

			return files.length > 0 ? files[0] : null;
		} catch {
			return null;
		}
	}

	private formatLifelogMarkdown(lifelog: {
		markdown?: string; 
		title?: string; 
		contents?: Array<{
			type: string; 
			content: string; 
			speakerName?: string; 
			startTime?: string;
		}>
	}): string {
		if (lifelog.markdown) {
			// Reformat Markdown
			const reformattedMarkdown = lifelog.markdown.split('\n\n').join('\n');
			return reformattedMarkdown;
		}

		const content: string[] = [];

		if (lifelog.title) {
			content.push(`# ${lifelog.title}\n`);
		}

		if (lifelog.contents) {
			let currentSection = '';
			let sectionMessages: string[] = [];

			for (const node of lifelog.contents) {
				if (node.type === 'heading2') {
					if (currentSection && sectionMessages.length > 0) {
						content.push(`## ${currentSection}\n`);
						content.push(...sectionMessages);
						content.push('');
					}
					currentSection = node.content;
					sectionMessages = [];
				} else if (node.type === 'blockquote') {
					const speaker = node.speakerName || 'Speaker';
					let timestamp = '';
					if (node.startTime) {
						const dt = new Date(node.startTime);
						timestamp = dt.toLocaleString('en-US', {
							month: '2-digit',
							day: '2-digit',
							year: '2-digit',
							hour: 'numeric',
							minute: '2-digit',
							hour12: true
						});
						timestamp = `(${timestamp})`;
					}

					const message = `- ${speaker} ${timestamp}: ${node.content}`;
					if (currentSection) {
						sectionMessages.push(message);
					} else {
						content.push(message);
					}
				} else if (node.type !== 'heading1') {
					content.push(node.content);
				}
			}

			if (currentSection && sectionMessages.length > 0) {
				content.push(`## ${currentSection}\n`);
				content.push(...sectionMessages);
			}
		}

		return content.join('\n\n');
	}

	async syncChats() {
		if (!this.settings.syncChats) {
			return;
		}

		if (!this.settings.apiKey) {
			new Notice('Please set your Limitless API key in settings');
			return;
		}

		try {
			const chatFolderPath = normalizePath(this.settings.chatFolderPath);
			await this.ensureFolderExists(chatFolderPath);

			new Notice('Starting chat sync...');

			let cursor: string | undefined;
			let processedChats = 0;

			do {
				const result = await this.api.getChats({
					cursor,
					limit: Math.min(this.settings.maxChatsPerSync || 50, 100),
					direction: 'desc',
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
				});

				for (const chat of result.chats || []) {
					await this.processChatFile(chat, chatFolderPath);
					processedChats++;
				}

				const responseMeta = result.meta as {chats?: {nextCursor?: string}} | undefined;
				cursor = responseMeta?.chats?.nextCursor;
			} while (cursor && processedChats < (this.settings.maxChatsPerSync || 200));

			new Notice(`Chat sync complete! Processed ${processedChats} chats.`);
		} catch (error) {
			console.error('Error syncing chats:', error);
			new Notice('Error syncing chats. Check console for details.');
		}
	}

	private async processChatFile(chat: Chat, folderPath: string) {
		try {
			const filePath = this.getChatFilePath(chat, folderPath);
			const content = this.formatChatMarkdown(chat);

			// Check if file exists and compare content
			const existingContent = await this.getExistingFileContent(filePath);
			if (existingContent !== content) {
				await this.app.vault.adapter.write(filePath, content);
			}
		} catch (error) {
			console.error('Error processing chat file:', error);
		}
	}

	private async getExistingFileContent(filePath: string): Promise<string | null> {
		try {
			return await this.app.vault.adapter.read(filePath);
		} catch {
			return null;
		}
	}

	private getChatFilePath(chat: Chat, folderPath: string): string {
		const date = new Date(chat.createdAt);

		switch (this.settings.chatFileFormat) {
			case 'per-chat': {
				const safeTitle = this.sanitizeFilename(chat.summary || `Chat ${chat.id}`);
				return `${folderPath}/${safeTitle} - ${chat.id.slice(0, 8)}.md`;
			}

			case 'daily':
				return `${folderPath}/${date.toISOString().split('T')[0]} - Chats.md`;

			case 'monthly':
				return `${folderPath}/${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')} - Chats.md`;

			default:
				return `${folderPath}/${chat.id}.md`;
		}
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
	}

	private formatChatMarkdown(chat: Chat): string {
		const content: string[] = [];

		// Header with metadata
		content.push(`# ${chat.summary || 'Chat Conversation'}`);
		content.push(`**Chat ID:** ${chat.id}`);
		content.push(`**Created:** ${new Date(chat.createdAt).toLocaleString()}`);
		content.push(`**Started:** ${new Date(chat.startedAt).toLocaleString()}`);
		content.push(`**Visibility:** ${chat.visibility}`);
		content.push('');

		// Process messages
		if (chat.messages && chat.messages.length > 0) {
			content.push('## Conversation');
			content.push('');

			for (const message of chat.messages) {
				content.push(`### ${this.formatRole(message.user.role)} ${message.user.name || ''}`);
				content.push(`*${new Date(message.createdAt).toLocaleString()}*`);
				content.push('');

				if (message.text) {
					content.push(message.text);
					content.push('');
				}

				// Format tool calls
				if (message.toolCalls && message.toolCalls.length > 0) {
					content.push('**Tool Calls:**');
					for (const toolCall of message.toolCalls) {
						content.push(`- ${toolCall.toolName}: \`${JSON.stringify(toolCall.args)}\``);
					}
					content.push('');
				}

				// Format tool results
				if (message.toolResults && message.toolResults.length > 0) {
					content.push('**Tool Results:**');
					for (const result of message.toolResults) {
						content.push(`- ${result.toolName}: ${result.isError ? 'Error' : 'Success'}`);
						if (result.entriesReturned) {
							for (const entry of result.entriesReturned) {
								content.push(`  - [[${entry.title}]] (${entry.id})`);
							}
						}
					}
					content.push('');
				}

				content.push('---');
				content.push('');
			}
		}

		return content.join('\n');
	}

	private formatRole(role: string): string {
		return role.charAt(0).toUpperCase() + role.slice(1);
	}

	// New method to sync selected chats
	async syncSelectedChats(selectedChats: Chat[]) {
		if (!this.settings.syncChats) return;

		if (!this.settings.apiKey) {
			new Notice('Please set your Limitless API key in settings');
			return;
		}

		try {
			const chatFolderPath = normalizePath(this.settings.chatFolderPath);
			await this.ensureFolderExists(chatFolderPath);
			await this.createChatSubdirectories(chatFolderPath);

			new Notice(`Starting sync of ${selectedChats.length} selected chats...`);

			const processedChats: string[] = [];
			const allCheckboxes: string[] = [];

			for (const chat of selectedChats) {
				const result = await this.processSelectedChatFile(chat, chatFolderPath);
				if (result.filename) {
					processedChats.push(result.filename);
				}
				if (result.checkboxes) {
					allCheckboxes.push(...result.checkboxes);
				}
			}

			// Create aggregated checkbox file
			if (this.settings.createCheckboxAggregation && allCheckboxes.length > 0) {
				await this.createCheckboxAggregationFile(allCheckboxes);
			}

			new Notice(`Sync complete! Processed ${processedChats.length} chats.`);
		} catch (error) {
			console.error('Error syncing selected chats:', error);
			new Notice('Error syncing selected chats. Check console for details.');
		}
	}

	private async createChatSubdirectories(basePath: string) {
		const subdirs = [
			'done-better',
			'daily-summary', 
			'todos',
			'custom/personal-journal',
			'custom/learning-points',
			'custom/clinical-handover',
			'custom/concept-insights',
			'custom/weekly-review',
			'custom/mitigate-biases'
		];

		for (const subdir of subdirs) {
			const fullPath = normalizePath(`${basePath}/${subdir}`);
			await this.ensureFolderExists(fullPath);
		}
	}

	private async processSelectedChatFile(chat: Chat, folderPath: string): Promise<{filename?: string, checkboxes?: string[]}> {
		try {
			const filePath = this.getSmartChatFilePath(chat, folderPath);
			const content = this.formatSmartChatMarkdown(chat);
			const checkboxes = this.extractCheckboxes(content);

			// Check if file exists and compare content
			const existingContent = await this.getExistingFileContent(filePath);
			if (existingContent !== content) {
				await this.app.vault.adapter.write(filePath, content);
			}

			return {
				filename: filePath.split('/').pop(),
				checkboxes
			};
		} catch (error) {
			console.error('Error processing selected chat file:', error);
			return {};
		}
	}

	getSmartChatFilePath(chat: Chat, folderPath: string): string {
		const date = new Date(chat.createdAt);
		const dateStr = date.toISOString().split('T')[0].replace(/-/g, '-').substring(2); // YY-MM-DD

		// Determine chat type and subfolder
		let subfolder = '';
		let filename = '';

		const summary = chat.summary?.toLowerCase() || '';

		if (summary.includes('done better')) {
			subfolder = 'done-better';
			filename = `${dateStr}_done-better`;
		} else if (summary.includes('daily summary')) {
			subfolder = 'daily-summary';
			filename = `${dateStr}_daily-summary`;
		} else if (summary.includes('todos')) {
			subfolder = 'todos';
			filename = `${dateStr}_todos`;
		} else if (summary.includes('custom message')) {
			// Try to determine custom type from content
			const customType = this.inferCustomMessageType(chat);
			subfolder = `custom/${customType}`;
			filename = `${dateStr}_${customType}`;
		} else {
			// Default to custom/general
			subfolder = 'custom';
			filename = `${dateStr}_${this.sanitizeFilename(summary || 'chat')}`;
		}

		return `${folderPath}/${subfolder}/${filename}.md`;
	}

	private inferCustomMessageType(chat: Chat): string {
		// Look at the first user message to infer type
		const firstUserMessage = chat.messages?.find(m => m.user.role === 'user')?.text?.toLowerCase() || '';

		if (firstUserMessage.includes('journal') || firstUserMessage.includes('personal')) {
			return 'personal-journal';
		} else if (firstUserMessage.includes('learn') || firstUserMessage.includes('insight')) {
			return 'learning-points';
		} else if (firstUserMessage.includes('handover') || firstUserMessage.includes('clinical')) {
			return 'clinical-handover';
		} else if (firstUserMessage.includes('concept') || firstUserMessage.includes('understand')) {
			return 'concept-insights';
		} else if (firstUserMessage.includes('week') || firstUserMessage.includes('review')) {
			return 'weekly-review';
		} else if (firstUserMessage.includes('bias') || firstUserMessage.includes('mitigate')) {
			return 'mitigate-biases';
		} else {
			return 'general';
		}
	}

	formatSmartChatMarkdown(chat: Chat): string {
		const isCustomMessage = chat.summary?.toLowerCase().includes('custom message');
		const content: string[] = [];

		// Add YAML frontmatter
		content.push('---');
		content.push(`type: "${chat.summary || 'Chat Conversation'}"`);
		content.push(`date: "${new Date(chat.createdAt).toISOString().split('T')[0]}"`);
		content.push(`created: "${new Date(chat.createdAt).toLocaleString()}"`);
		content.push(`chat_id: "${chat.id}"`);
		content.push(`visibility: "${chat.visibility}"`);
		content.push('---');
		content.push('');

		// Process messages
		if (chat.messages && chat.messages.length > 0) {
			const messagesToProcess = isCustomMessage 
				? chat.messages.filter(m => m.user.role !== 'user') // Skip user messages for custom messages
				: chat.messages;

			for (const message of messagesToProcess) {
				if (message.text) {
					// For custom messages, look for YAML frontmatter and start from there
					if (isCustomMessage && message.user.role === 'assistant') {
						const yamlIndex = message.text.indexOf('---');
						if (yamlIndex !== -1) {
							// Extract content starting from the YAML delimiter
							const contentFromYaml = message.text.substring(yamlIndex);
							// Skip the YAML frontmatter in the message and add our own
							const contentAfterYaml = this.extractContentAfterYaml(contentFromYaml);
							content.push(contentAfterYaml);
						} else {
							content.push(message.text);
						}
					} else {
						content.push(`### ${this.formatRole(message.user.role)} ${message.user.name || ''}`);
						content.push(`*${new Date(message.createdAt).toLocaleString()}*`);
						content.push('');
						content.push(message.text);
						content.push('');
					}
				}

				// Format tool calls
				if (message.toolCalls && message.toolCalls.length > 0) {
					content.push('**Tool Calls:**');
					for (const toolCall of message.toolCalls) {
						content.push(`- ${toolCall.toolName}: \`${JSON.stringify(toolCall.args)}\``);
					}
					content.push('');
				}

				// Format tool results
				if (message.toolResults && message.toolResults.length > 0) {
					content.push('**Tool Results:**');
					for (const result of message.toolResults) {
						content.push(`- ${result.toolName}: ${result.isError ? 'Error' : 'Success'}`);
						if (result.entriesReturned) {
							for (const entry of result.entriesReturned) {
								content.push(`  - [[${entry.title}]] (${entry.id})`);
							}
						}
					}
					content.push('');
				}

				if (!isCustomMessage) {
					content.push('---');
					content.push('');
				}
			}
		}

		return content.join('\n');
	}

	private extractContentAfterYaml(yamlContent: string): string {
		// Find the end of the YAML frontmatter
		const lines = yamlContent.split('\n');
		let yamlEndIndex = -1;

		// Look for the second '---' to end YAML
		let yamlDelimiterCount = 0;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				yamlDelimiterCount++;
				if (yamlDelimiterCount === 2) {
					yamlEndIndex = i;
					break;
				}
			}
		}

		if (yamlEndIndex !== -1 && yamlEndIndex < lines.length - 1) {
			return lines.slice(yamlEndIndex + 1).join('\n');
		}

		return yamlContent;
	}

	private extractCheckboxes(content: string): string[] {
		const checkboxRegex = /^\s*- \[ \]\s*(.+)$/gm;
		const matches = [];
		let match;

		while ((match = checkboxRegex.exec(content)) !== null) {
			matches.push(match[1].trim());
		}

		return matches;
	}

	private async createCheckboxAggregationFile(checkboxes: string[]) {
		const aggregationPath = normalizePath(`${this.settings.chatFolderPath}/${this.settings.checkboxAggregationFile}`);
		const content = [
			'# Aggregated Todo Items',
			'',
			`*Last updated: ${new Date().toLocaleString()}*`,
			'',
			'## Items from Chat Sync',
			'',
			...checkboxes.map(checkbox => `- [ ] ${checkbox}`),
			'',
			'---',
			'',
			'*This file is automatically generated from checkbox items found in synced chats.*'
		];

		try {
			await this.app.vault.adapter.write(aggregationPath, content.join('\n'));
			new Notice(`Created aggregated todo list with ${checkboxes.length} items.`);
		} catch (error) {
			console.error('Error creating checkbox aggregation file:', error);
		}
	}

	private addSvgIcon() {
		const limitlessLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20"><g fill="currentColor" clip-path="url(#a)"><g opacity=".66"><path d="M12.9761 7.2573c-.134-.01168-.2414-.11909-.2532-.25329-.0473-.5424-.107-1.06543-.1779-1.56483-.0436-.30586.0802-.61395.333-.7916 1.9081-1.34124 3.4038-1.9422 3.9072-1.43895.5023.50234-.0954 1.99315-1.4313 3.89612-.1777.25321-.4863.37714-.7926.33335-.5054-.07228-1.0353-.13294-1.5852-.1808ZM15.3539 12.8889c-.1777-.2532-.4863-.3772-.7926-.3334-.5054.0724-1.0353.133-1.5852.1809-.134.0117-.2414.119-.2532.2533-.0473.5424-.107 1.0655-.1779 1.5648-.0436.3059.0802.6139.333.7916 1.9083 1.3413 3.4038 1.9424 3.9072 1.4391.5023-.5025-.0954-1.9933-1.4313-3.8963ZM7.09005 15.3642c.25346-.1776.37761-.4863.33385-.7927-.07206-.5046-.1326-1.0333-.18028-1.5818-.01178-.1343-.11915-.2416-.25328-.2533-.54107-.0471-1.06289-.1066-1.56115-.1773-.30605-.0435-.61432.0805-.79187.3335-1.33407 1.9013-1.93063 3.3905-1.4287 3.8926.50118.5008 1.98551-.0924 3.88143-1.421ZM5.42919 7.43467c-.30605.04348-.61432-.08052-.79187-.33356-1.33407-1.90122-1.93063-3.39049-1.4287-3.89249.50118-.50097 1.9855.09238 3.88141 1.4209.25347.17762.37762.48635.33387.79274-.07206.50449-.1326 1.0332-.18028 1.58175-.01178.13419-.11915.2416-.25328.25328-.54107.0471-1.06289.10661-1.56115.17738Z"/></g><path d="M12.0939 7.12002c.0302.42032.3659.75599.7861.78617C16.7749 8.18581 19.6 9.01749 19.6 10c0 .9826-2.8251 1.8142-6.72 2.0939-.4202.0301-.7559.3658-.7861.7861-.2796 3.8949-1.1113 6.72-2.0939 6.72-.98251 0-1.81429-2.8251-2.09387-6.72-.03017-.4203-.36585-.756-.78617-.7861C3.22518 11.8142.40002 10.9826.40002 10c0-.98251 2.82516-1.81419 6.71994-2.09381.42032-.03018.756-.36585.78617-.78617.27958-3.8948 1.11136-6.72 2.09387-6.72.9826 0 1.8143 2.8252 2.0939 6.72Z"/></g><defs><clipPath id="a"><path fill="currentColor" d="M0 0h20v20H0z"/></clipPath></defs></svg>`;
		
		try {
			// Store SVG for later use in modal and settings
			(this as any).limitlessLogoSvg = limitlessLogoSvg;
			(this as any).limitlessWatermarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 78 20"><g fill="currentColor" opacity=".66"><path d="M12.9761 7.2573c-.134-.01168-.2414-.11909-.2532-.25329-.0473-.5424-.107-1.06543-.1779-1.56483-.0436-.30586.0802-.61395.333-.7916 1.9081-1.34124 3.4038-1.9422 3.9072-1.43895.5023.50234-.0954 1.99315-1.4313 3.89612-.1777.25321-.4863.37714-.7926.33335-.5054-.07228-1.0353-.13294-1.5852-.1808ZM15.3539 12.8889c-.1777-.2532-.4863-.3772-.7926-.3334-.5054.0724-1.0353.133-1.5852.1809-.134.0117-.2414.119-.2532.2533-.0473.5424-.107 1.0655-.1779 1.5648-.0436.3059.0802.6139.333.7916 1.9083 1.3413 3.4038 1.9424 3.9072 1.4391.5023-.5025-.0954-1.9933-1.4313-3.8963ZM7.09005 15.3642c.25346-.1776.37761-.4863.33385-.7927-.07206-.5046-.1326-1.0333-.18028-1.5818-.01178-.1343-.11915-.2416-.25328-.2533-.54107-.0471-1.06289-.1066-1.56115-.1773-.30605-.0435-.61432.0805-.79187.3335-1.33407 1.9013-1.93063 3.3905-1.4287 3.8926.50118.5008 1.98551-.0924 3.88143-1.421ZM5.42919 7.43467c-.30605.04348-.61432-.08052-.79187-.33356-1.33407-1.90122-1.93063-3.39049-1.4287-3.89249.50118-.50097 1.9855.09238 3.88141 1.4209.25347.17762.37762.48635.33387.79274-.07206.50449-.1326 1.0332-.18028 1.58175-.01178.13419-.11915.2416-.25328.25328-.54107.0471-1.06289.10661-1.56115.17738Z"/></g><path fill="currentColor" d="M12.0939 7.12002c.0302.42032.3659.75599.7861.78617C16.7749 8.18581 19.6 9.01749 19.6 10c0 .9826-2.8251 1.8142-6.72 2.0939-.4202.0301-.7559.3658-.7861.7861-.2796 3.8949-1.1113 6.72-2.0939 6.72-.98251 0-1.81429-2.8251-2.09387-6.72-.03017-.4203-.36585-.756-.78617-.7861C3.22518 11.8142.40002 10.9826.40002 10c0-.98251 2.82516-1.81419 6.71994-2.09381.42032-.03018.756-.36585.78617-.78617.27958-3.8948 1.11136-6.72 2.09387-6.72.9826 0 1.8143 2.8252 2.0939 6.72ZM72.3635 14.888c-1.148 0-2.016-.49-2.562-1.134-.084-.098-.07-.252.028-.406l.49-.686c.112-.168.238-.14.35-.056.574.434 1.05.672 1.582.672.462 0 .77-.182.77-.574 0-.336-.21-.49-.714-.7l-.868-.35c-.882-.35-1.498-.938-1.498-1.88998 0-1.316 1.12-2.072 2.394-2.072.896 0 1.722.364 2.296 1.05.084.098.056.21-.014.294l-.616.742c-.098.112-.196.098-.322 0-.448-.378-.84-.574-1.246-.574-.448 0-.658.252-.658.546 0 .33598.28.51798.658.65798l.966.378c.868.35 1.554.952 1.54 2.002-.014 1.386-1.204 2.1-2.576 2.1ZM66.3544 14.888c-1.148 0-2.016-.49-2.562-1.134-.084-.098-.07-.252.028-.406l.49-.686c.112-.168.238-.14.35-.056.574.434 1.05.672 1.582.672.462 0 .77-.182.77-.574 0-.336-.21-.49-.714-.7l-.868-.35c-.882-.35-1.498-.938-1.498-1.88998 0-1.316 1.12-2.072 2.394-2.072.896 0 1.722.364 2.296 1.05.084.098.056.21-.014.294l-.616.742c-.098.112-.196.098-.322 0-.448-.378-.84-.574-1.246-.574-.448 0-.658.252-.658.546 0 .33598.28.51798.658.65798l.966.378c.868.35 1.554.952 1.54 2.002-.014 1.386-1.204 2.1-2.576 2.1ZM60.0835 14.888c-2.254 0-3.766-1.554-3.766-3.626 0-2.01598 1.414-3.56998 3.528-3.56998 2.086 0 3.29 1.54 3.29 3.27598 0 .672-.154 1.05-.756 1.05h-4.172c.21.868.924 1.344 2.03 1.344.532 0 1.036-.098 1.596-.42.098-.056.168-.042.238.056l.518.714c.07.098.056.196-.07.308-.588.588-1.47.868-2.436.868Zm-1.904-4.228h3.234c-.112-.90998-.728-1.37198-1.554-1.37198-.854 0-1.512.462-1.68 1.37198ZM53.5481 14.72c-.126 0-.21-.084-.21-.21V4.92002c0-.126.084-.21.21-.21h1.526c.126 0 .21.084.21.21V14.51c0 .126-.084.21-.21.21h-1.526ZM51.2212 14.804c-1.092 0-2.072-.504-2.072-2.002V9.35798h-.868c-.126 0-.21-.084-.21-.21v-1.078c0-.126.084-.21.21-.21h.868v-1.61c0-.126.084-.21.21-.21h1.526c.126 0 .21.084.21.21v1.61h1.078c.126 0 .21.084.21.21v1.078c0 .126-.084.21-.21.21h-1.078V12.592c0 .406.238.602.602.602.126 0 .266 0 .434-.014.154-.014.252.056.252.196v1.022c0 .322-.7.406-1.162.406ZM46.2652 6.642c-.616 0-1.078-.476-1.078-1.078 0-.588.462-1.064 1.078-1.064.616 0 1.064.476 1.064 1.064 0 .602-.448 1.078-1.064 1.078Zm-.98 7.868V8.07c0-.126.084-.21.21-.21h1.526c.126 0 .21.084.21.21v6.44c0 .126-.084.21-.21.21h-1.526c-.126 0-.21-.084-.21-.21ZM33.8393 14.72c-.126 0-.21-.084-.21-.21V8.07002c0-.126.084-.21.21-.21h1.456c.126 0 .21.056.21.224l.042.728c.378-.644.994-1.12 1.932-1.12.882 0 1.568.42 1.946 1.218.378-.7 1.05-1.218 2.114-1.218 1.47 0 2.366 1.008 2.366 2.79998v4.018c0 .126-.084.21-.21.21h-1.512c-.126 0-.21-.084-.21-.21v-3.598c0-.93798-.336-1.44198-1.092-1.44198-.728 0-1.148.504-1.148 1.44198v3.598c0 .126-.084.21-.21.21h-1.498c-.14 0-.224-.084-.224-.21v-3.598c0-.93798-.35-1.44198-1.092-1.44198-.728 0-1.148.504-1.148 1.44198v3.598c0 .126-.084.21-.21.21h-1.512ZM31.2666 6.642c-.616 0-1.078-.476-1.078-1.078 0-.588.462-1.064 1.078-1.064.616 0 1.064.476 1.064 1.064 0 .602-.448 1.078-1.064 1.078Zm-.98 7.868V8.07c0-.126.084-.21.21-.21h1.526c.126 0 .21.084.21.21v6.44c0 .126-.084.21-.21.21h-1.526c-.126 0-.21-.084-.21-.21ZM24.176 14.72c-.126 0-.21-.084-.21-.21V5.12998c0-.126.084-.21.21-.21h1.582c.126 0 .21.084.21.21V12.942h2.996c.126 0 .21.084.21.21v1.358c0 .126-.084.21-.21.21h-4.788Z"/></svg>`;
		} catch (error) {
			console.log('Could not store SVG icons:', error);
		}
	}

	async syncSelectedItems(selectedItems: SyncItem[]) {
		const selectedChats = selectedItems.filter(item => item.type === 'chat').map(item => item.data as Chat);
		const selectedLifelogs = selectedItems.filter(item => item.type === 'lifelog').map(item => item.data as LifelogEntry);

		if (selectedChats.length > 0) {
			await this.syncSelectedChats(selectedChats);
		}

		if (selectedLifelogs.length > 0) {
			await this.syncSelectedLifelogsInternal(selectedLifelogs);
		}
	}

	async syncSelectedLifelogsInternal(selectedLifelogs: LifelogEntry[]) {
		if (!this.settings.apiKey) {
			new Notice('Please set your Limitless API key in settings');
			return;
		}

		try {
			const folderPath = normalizePath(this.settings.folderPath);
			await this.ensureFolderExists(folderPath);

			new Notice(`Starting sync of ${selectedLifelogs.length} selected lifelogs...`);

			for (const lifelog of selectedLifelogs) {
				if (!lifelog.alreadySynced) {
					const content = this.formatLifelogMarkdown(lifelog.rawData as {
						markdown?: string; 
						title?: string; 
						contents?: Array<{
							type: string; 
							content: string; 
							speakerName?: string; 
							startTime?: string;
						}>
					});
					const filePath = `${folderPath}/${lifelog.date}.md`;
					await this.app.vault.adapter.write(filePath, content);
				}
			}

			const syncedCount = selectedLifelogs.filter(l => !l.alreadySynced).length;
			new Notice(`Lifelog sync complete! Processed ${syncedCount} new lifelogs.`);
		} catch (error) {
			console.error('Error syncing selected lifelogs:', error);
			new Notice('Error syncing selected lifelogs. Check console for details.');
		}
	}
}

interface CategorizedChats {
	[category: string]: Chat[];
}

interface CategorizedLifelogs {
	[category: string]: LifelogEntry[];
}

interface LifelogEntry {
	id: string;
	date: string;
	title?: string;
	contentPreview: string;
	filePath?: string;
	alreadySynced?: boolean;
	rawData: unknown;
}

interface SyncItem {
	id: string;
	type: 'chat' | 'lifelog';
	data: Chat | LifelogEntry;
	category: string;
	alreadySynced: boolean;
}

class UnifiedSyncModal extends Modal {
	plugin: LimitlessLifelogsPlugin;
	availableChats: Chat[] = [];
	availableLifelogs: LifelogEntry[] = [];
	categorizedChats: CategorizedChats = {};
	categorizedLifelogs: CategorizedLifelogs = {};
	selectedItemIds: Set<string> = new Set();
	previewItem: SyncItem | null = null;
	loadingData = false;
	startDate: string;
	endDate: string;
	currentTab: 'chats' | 'lifelogs' = 'chats';
	searchQuery = '';
	previewSettings = {
		hideUserNames: true,
		hidePrefixes: true,
		convertToYaml: true,
		convertToChecklists: true,
		showMetadata: true
	};

	constructor(app: App, plugin: LimitlessLifelogsPlugin) {
		super(app);
		this.plugin = plugin;
		
		// Default to last 30 days
		const now = new Date();
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		this.endDate = now.toISOString().split('T')[0];
		this.startDate = thirtyDaysAgo.toISOString().split('T')[0];
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('unified-sync-modal');

		// Add custom styles
		this.addCustomStyles();

		// Header with logo
		const header = contentEl.createDiv('modal-header');
		const logoContainer = header.createDiv('logo-container');
		logoContainer.innerHTML = (this.plugin as any).limitlessWatermarkSvg || '';
		header.createEl('h2', { text: 'Limitless Sync Manager' });

		// Tab navigation
		this.createTabNavigation(contentEl);

		// Date range and search controls
		this.createControlsPanel(contentEl);

		// Main content area with enhanced layout
		const mainContent = contentEl.createDiv('main-content');
		mainContent.style.display = 'flex';
		mainContent.style.gap = '20px';
		mainContent.style.height = '70vh';
		mainContent.style.minHeight = '500px';

		// Left panel - item selection (60% width)
		const leftPanel = mainContent.createDiv('left-panel');
		leftPanel.style.flex = '1.5';
		leftPanel.style.display = 'flex';
		leftPanel.style.flexDirection = 'column';
		leftPanel.style.minWidth = '400px';

		// Right panel - interactive preview (40% width)
		const rightPanel = mainContent.createDiv('right-panel');
		rightPanel.style.flex = '1';
		rightPanel.style.border = '1px solid var(--background-modifier-border)';
		rightPanel.style.borderRadius = '8px';
		rightPanel.style.overflow = 'hidden';
		rightPanel.style.display = 'flex';
		rightPanel.style.flexDirection = 'column';

		// Initialize preview panel
		this.createPreviewPanel(rightPanel);

		// Load data automatically
		await this.loadChatsInRange(leftPanel);

		// Enhanced action buttons
		this.createActionButtons(contentEl);
	}

	private addCustomStyles() {
		const styleEl = document.createElement('style');
		styleEl.textContent = `
			.unified-sync-modal .modal-content {
				max-width: 1400px;
				width: 95vw;
				max-height: 90vh;
				height: 85vh;
				padding: 20px;
			}
			.modal-header {
				display: flex;
				align-items: center;
				gap: 16px;
				margin-bottom: 20px;
				padding-bottom: 16px;
				border-bottom: 2px solid var(--background-modifier-border);
			}
			.modal-header h2 {
				margin: 0;
				flex: 1;
			}
			.logo-container {
				height: 24px;
				opacity: 0.8;
			}
			.logo-container svg {
				height: 100%;
			}
			.tab-navigation {
				display: flex;
				gap: 4px;
				margin-bottom: 16px;
				background: var(--background-secondary);
				padding: 4px;
				border-radius: 8px;
			}
			.tab-button {
				padding: 8px 16px;
				border: none;
				background: transparent;
				border-radius: 6px;
				cursor: pointer;
				transition: all 0.2s;
				font-weight: 500;
			}
			.tab-button.active {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.tab-button:hover:not(.active) {
				background: var(--background-modifier-hover);
			}
			.controls-panel {
				background: var(--background-secondary);
				padding: 16px;
				border-radius: 8px;
				margin-bottom: 20px;
			}
			.controls-row {
				display: flex;
				align-items: center;
				gap: 12px;
				margin-bottom: 12px;
			}
			.controls-row:last-child {
				margin-bottom: 0;
			}
			.search-container {
				flex: 1;
				position: relative;
			}
			.search-input {
				width: 100%;
				padding: 8px 12px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				background: var(--background-primary);
			}
			.sync-section {
				margin-bottom: 16px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 8px;
				overflow: hidden;
			}
			.section-header {
				background: var(--background-secondary);
				padding: 12px 16px;
				font-weight: 600;
				border-bottom: 1px solid var(--background-modifier-border);
				display: flex;
				justify-content: space-between;
				align-items: center;
				cursor: pointer;
				transition: background-color 0.2s;
			}
			.section-header:hover {
				background: var(--background-modifier-hover);
			}
			.section-content {
				max-height: 300px;
				overflow-y: auto;
			}
			.sync-item {
				padding: 12px 16px;
				border-bottom: 1px solid var(--background-modifier-border-focus);
				cursor: pointer;
				transition: all 0.2s;
				display: flex;
				align-items: center;
				gap: 12px;
			}
			.sync-item:hover {
				background: var(--background-modifier-hover);
			}
			.sync-item.selected {
				background: var(--background-modifier-active-hover);
				border-left: 3px solid var(--interactive-accent);
			}
			.sync-item.already-synced {
				opacity: 0.6;
				background: var(--background-secondary-alt);
			}
			.sync-item-info {
				flex: 1;
			}
			.sync-item-title {
				font-weight: 500;
				margin-bottom: 4px;
				line-height: 1.3;
			}
			.sync-item-meta {
				font-size: 0.85em;
				opacity: 0.7;
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.sync-status {
				font-size: 0.75em;
				padding: 2px 6px;
				border-radius: 4px;
				font-weight: 500;
			}
			.sync-status.synced {
				background: var(--color-orange);
				color: white;
			}
			.sync-status.new {
				background: var(--color-green);
				color: white;
			}
			.category-header {
				background: var(--background-secondary);
				padding: 8px 12px;
				font-weight: bold;
				border-bottom: 1px solid var(--background-modifier-border);
				display: flex;
				justify-content: space-between;
				align-items: center;
				cursor: pointer;
			}
			.category-content {
				max-height: 200px;
				overflow-y: auto;
			}
			.chat-item {
				padding: 8px 12px;
				border-bottom: 1px solid var(--background-modifier-border-focus);
				cursor: pointer;
				transition: background-color 0.2s;
			}
			.chat-item:hover {
				background: var(--background-modifier-hover);
			}
			.chat-item.selected {
				background: var(--background-modifier-active-hover);
			}
			.preview-panel {
				font-size: 0.9em;
				line-height: 1.4;
			}
			.preview-header {
				font-weight: bold;
				margin-bottom: 12px;
				padding-bottom: 8px;
				border-bottom: 2px solid var(--background-modifier-border);
			}
					.loading-spinner {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
			font-style: italic;
		}
		.preview-controls {
			padding: 12px 16px;
			border-bottom: 1px solid var(--background-modifier-border);
			background: var(--background-secondary-alt);
		}
		.preview-control {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 8px;
			font-size: 0.9em;
		}
		.preview-control:last-child {
			margin-bottom: 0;
		}
		.faded-text {
			opacity: 0.4;
			text-decoration: line-through;
		}
		.yaml-converted {
			color: var(--color-accent);
			font-style: italic;
		}
		.checklist-converted {
			color: var(--color-green);
		}
		.selection-summary {
			font-weight: 500;
			color: var(--interactive-accent);
		}
		.enhanced-actions {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-top: 20px;
			padding: 16px 0;
			border-top: 2px solid var(--background-modifier-border);
		}
		.action-group {
			display: flex;
			align-items: center;
			gap: 12px;
		}
	`;
	document.head.appendChild(styleEl);
}

private createTabNavigation(containerEl: HTMLElement) {
	const tabNav = containerEl.createDiv('tab-navigation');
	
	const chatTab = tabNav.createEl('button', { 
		text: 'Chats',
		cls: 'tab-button' + (this.currentTab === 'chats' ? ' active' : '')
	});
	
	const lifelogTab = tabNav.createEl('button', { 
		text: 'Lifelogs', 
		cls: 'tab-button' + (this.currentTab === 'lifelogs' ? ' active' : '')
	});
	
	chatTab.addEventListener('click', () => {
		this.currentTab = 'chats';
		this.updateTabStyles();
		this.reloadCurrentTab();
	});
	
	lifelogTab.addEventListener('click', () => {
		this.currentTab = 'lifelogs'; 
		this.updateTabStyles();
		this.reloadCurrentTab();
	});
}

private updateTabStyles() {
	const tabs = this.contentEl.querySelectorAll('.tab-button');
	tabs.forEach(tab => tab.classList.remove('active'));
	
	const activeIndex = this.currentTab === 'chats' ? 0 : 1;
	tabs[activeIndex]?.classList.add('active');
}

private async reloadCurrentTab() {
	const leftPanel = this.contentEl.querySelector('.left-panel') as HTMLElement;
	if (leftPanel) {
		await this.loadChatsInRange(leftPanel);
	}
}

private createControlsPanel(containerEl: HTMLElement) {
	const controlsPanel = containerEl.createDiv('controls-panel');
	
	// Date range row
	const dateRow = controlsPanel.createDiv('controls-row');
	dateRow.createEl('label', { text: 'From:' });
	
	const startInput = dateRow.createEl('input', { type: 'date' });
	startInput.value = this.startDate;
	startInput.addEventListener('change', (e) => {
		this.startDate = (e.target as HTMLInputElement).value;
	});
	
	dateRow.createEl('label', { text: 'To:' });
	const endInput = dateRow.createEl('input', { type: 'date' });
	endInput.value = this.endDate;
	endInput.addEventListener('change', (e) => {
		this.endDate = (e.target as HTMLInputElement).value;
	});
	
	new ButtonComponent(dateRow)
		.setButtonText('Load Data')
		.setCta()
		.onClick(async () => {
			const leftPanel = containerEl.querySelector('.left-panel') as HTMLElement;
			if (leftPanel) {
				await this.loadChatsInRange(leftPanel);
			}
		});
	
	// Quick date buttons
	const quickDateRow = controlsPanel.createDiv('controls-row');
	[
		{ label: '7 days', days: 7 },
		{ label: '30 days', days: 30 },
		{ label: '90 days', days: 90 }
	].forEach(range => {
		new ButtonComponent(quickDateRow)
			.setButtonText(range.label)
			.onClick(() => {
				const now = new Date();
				const startDate = new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000);
				this.startDate = startDate.toISOString().split('T')[0];
				this.endDate = now.toISOString().split('T')[0];
				startInput.value = this.startDate;
				endInput.value = this.endDate;
			});
	});
	
	// Search row
	const searchRow = controlsPanel.createDiv('controls-row');
	const searchContainer = searchRow.createDiv('search-container');
	const searchInput = searchContainer.createEl('input', {
		type: 'text',
		placeholder: `Search ${this.currentTab}...`,
		cls: 'search-input'
	});
	
	searchInput.addEventListener('input', (e) => {
		this.searchQuery = (e.target as HTMLInputElement).value;
		// TODO: Implement filtering
	// this.filterDisplayedItems();
	});
}

	private createDateRangeControls(containerEl: HTMLElement) {
		const dateControls = containerEl.createDiv('date-controls');
		dateControls.style.display = 'flex';
		dateControls.style.gap = '16px';
		dateControls.style.alignItems = 'center';
		dateControls.style.marginBottom = '16px';
		dateControls.style.padding = '12px';
		dateControls.style.background = 'var(--background-secondary)';
		dateControls.style.borderRadius = '6px';

		// Start date
		const startLabel = dateControls.createEl('label');
		startLabel.textContent = 'From: ';
		const startInput = startLabel.createEl('input', { type: 'date' });
		startInput.value = this.startDate;
		startInput.addEventListener('change', (e) => {
			this.startDate = (e.target as HTMLInputElement).value;
		});

		// End date
		const endLabel = dateControls.createEl('label');
		endLabel.textContent = 'To: ';
		const endInput = endLabel.createEl('input', { type: 'date' });
		endInput.value = this.endDate;
		endInput.addEventListener('change', (e) => {
			this.endDate = (e.target as HTMLInputElement).value;
		});

		// Load button
		new ButtonComponent(dateControls)
			.setButtonText('Load Chats')
			.setCta()
			.onClick(async () => {
				const leftPanel = containerEl.querySelector('.left-panel') as HTMLElement;
				if (leftPanel) {
					await this.loadChatsInRange(leftPanel);
				}
			});

		// Quick date buttons
		const quickButtons = dateControls.createDiv('quick-dates');
		quickButtons.style.display = 'flex';
		quickButtons.style.gap = '8px';

		const quickRanges = [
			{ label: 'Last 7 days', days: 7 },
			{ label: 'Last 30 days', days: 30 },
			{ label: 'Last 90 days', days: 90 }
		];

		quickRanges.forEach(range => {
			new ButtonComponent(quickButtons)
				.setButtonText(range.label)
				.onClick(() => {
					const now = new Date();
					const startDate = new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000);
					this.startDate = startDate.toISOString().split('T')[0];
					this.endDate = now.toISOString().split('T')[0];
					startInput.value = this.startDate;
					endInput.value = this.endDate;
				});
		});
	}

	private async loadChatsInRange(leftPanel: HTMLElement) {
		leftPanel.empty();
		this.availableChats = [];
		this.categorizedChats = {};
		this.selectedItemIds.clear();

		const loadingEl = leftPanel.createDiv('loading-spinner');
		loadingEl.innerHTML = '⏳ Loading chats in date range...';

		try {
			this.loadingData = true;
			
			// Load ALL chats in the date range with pagination
			const allChats = await this.loadAllChatsInRange();
			this.availableChats = allChats;
			
			// Categorize chats
			this.categorizeChats();
			
			loadingEl.remove();
			this.loadingData = false;

			if (allChats.length === 0) {
				leftPanel.createEl('p', { text: 'No chats found in this date range.' });
				return;
			}

			// Create categorized chat display
			this.createCategorizedChatList(leftPanel);

		} catch (error) {
			loadingEl.innerHTML = '❌ Error loading chats. Please check your API key and connection.';
			console.error('Error loading chats:', error);
			this.loadingData = false;
		}
	}

	private async loadAllChatsInRange(): Promise<Chat[]> {
		const allChats: Chat[] = [];
		let cursor: string | undefined;
		let totalLoaded = 0;

		do {
			try {
				const result = await this.plugin.api.getChats({
					cursor,
					limit: 100,
					direction: 'desc',
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
				});

				const chats = result.chats || [];
				
				// Filter chats by date range
				const filteredChats = chats.filter(chat => {
					const chatDate = new Date(chat.createdAt).toISOString().split('T')[0];
					return chatDate >= this.startDate && chatDate <= this.endDate;
				});

				allChats.push(...filteredChats);
				totalLoaded += chats.length;

				// Update loading message
				const loadingEl = document.querySelector('.loading-spinner');
				if (loadingEl) {
					loadingEl.innerHTML = `⏳ Loaded ${allChats.length} chats in range (${totalLoaded} total scanned)...`;
				}

				const responseMeta = result.meta as {chats?: {nextCursor?: string}} | undefined;
				cursor = responseMeta?.chats?.nextCursor;

				// Safety check - if we've gone beyond our date range, stop
				if (chats.length > 0) {
					const oldestChatDate = new Date(chats[chats.length - 1].createdAt).toISOString().split('T')[0];
					if (oldestChatDate < this.startDate) {
						break;
					}
				}

			} catch (error) {
				console.error('Error in pagination:', error);
				break;
			}
		} while (cursor);

		return allChats;
	}

	private categorizeChats() {
		this.categorizedChats = {
			'Done Better': [],
			'Daily Summary': [],
			'Todos': [],
			'Personal Journal': [],
			'Learning Points': [],
			'Clinical Handover': [],
			'Concept Insights': [],
			'Weekly Review': [],
			'Mitigate Biases': [],
			'General': []
		};

		this.availableChats.forEach(chat => {
			const category = this.inferChatCategory(chat);
			this.categorizedChats[category].push(chat);
		});

		// Remove empty categories
		Object.keys(this.categorizedChats).forEach(key => {
			if (this.categorizedChats[key].length === 0) {
				delete this.categorizedChats[key];
			}
		});
	}

	private inferChatCategory(chat: Chat): string {
		const summary = chat.summary?.toLowerCase() || '';
		const firstUserMessage = chat.messages?.find(m => m.user.role === 'user')?.text?.toLowerCase() || '';

		if (summary.includes('done better')) return 'Done Better';
		if (summary.includes('daily summary')) return 'Daily Summary';
		if (summary.includes('todos')) return 'Todos';
		if (summary.includes('journal') || firstUserMessage.includes('journal')) return 'Personal Journal';
		if (summary.includes('learn') || firstUserMessage.includes('insight')) return 'Learning Points';
		if (summary.includes('handover') || firstUserMessage.includes('clinical')) return 'Clinical Handover';
		if (summary.includes('concept') || firstUserMessage.includes('understand')) return 'Concept Insights';
		if (summary.includes('week') || firstUserMessage.includes('review')) return 'Weekly Review';
		if (summary.includes('bias') || firstUserMessage.includes('mitigate')) return 'Mitigate Biases';
		
		return 'General';
	}

	private createCategorizedChatList(leftPanel: HTMLElement) {
		// Control buttons
		const buttonContainer = leftPanel.createDiv('chat-selection-buttons');
		buttonContainer.style.marginBottom = '16px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.flexWrap = 'wrap';

		new ButtonComponent(buttonContainer)
			.setButtonText('Select All')
			.onClick(() => {
				this.selectedItemIds = new Set(this.availableChats.map(chat => chat.id));
				this.updateVisualSelection();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText('Deselect All')
			.onClick(() => {
				this.selectedItemIds.clear();
				this.updateVisualSelection();
				this.clearPreview();
			});

		// Category selection buttons
		Object.keys(this.categorizedChats).forEach(category => {
			new ButtonComponent(buttonContainer)
				.setButtonText(`Select ${category}`)
				.onClick(() => {
					this.categorizedChats[category].forEach(chat => {
						this.selectedItemIds.add(chat.id);
					});
					this.updateVisualSelection();
				});
		});

		// Create categorized sections
		Object.entries(this.categorizedChats).forEach(([category, chats]) => {
			const categorySection = leftPanel.createDiv('category-section');
			
			const categoryHeader = categorySection.createDiv('category-header');
			categoryHeader.innerHTML = `${category} (${chats.length})`;
			
			const toggleIcon = categoryHeader.createSpan();
			toggleIcon.innerHTML = '▼';
			
			const categoryContent = categorySection.createDiv('category-content');
			
			// Toggle functionality
			let expanded = true;
			categoryHeader.addEventListener('click', () => {
				expanded = !expanded;
				categoryContent.style.display = expanded ? 'block' : 'none';
				toggleIcon.innerHTML = expanded ? '▼' : '▶';
			});
			
			// Add chats to category
			chats.forEach(chat => {
				const chatItem = categoryContent.createDiv('chat-item');
				chatItem.dataset.chatId = chat.id;
				
				chatItem.innerHTML = `
					<div style="display: flex; align-items: center; gap: 12px;">
						<input type="checkbox" class="chat-checkbox">
						<div style="flex: 1;">
							<div class="chat-title" style="font-weight: bold; margin-bottom: 4px;">
								${chat.summary || 'Untitled Chat'}
							</div>
							<div class="chat-metadata" style="font-size: 0.9em; opacity: 0.7;">
								${new Date(chat.createdAt).toLocaleString()} • ${chat.visibility}
							</div>
						</div>
					</div>
				`;
				
				const checkbox = chatItem.querySelector('.chat-checkbox') as HTMLInputElement;
				
				// Checkbox change handler
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						this.selectedItemIds.add(chat.id);
					} else {
						this.selectedItemIds.delete(chat.id);
						if (this.previewItem?.id === chat.id) {
							this.clearPreview();
						}
					}
					this.updateVisualSelection();
				});
				
				// Click to preview
				chatItem.addEventListener('click', (e) => {
					const target = e.target as HTMLElement;
					if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type !== 'checkbox') {
						this.showPreview(chat);
						this.updateVisualSelection();
					}
				});
			});
		});

	}

	private createPreviewPanel(rightPanel: HTMLElement) {
		rightPanel.innerHTML = `
			<div class="preview-header">Chat Preview</div>
			<div class="preview-content">
				<p style="text-align: center; opacity: 0.7; margin-top: 40px;">
					Select a chat to preview its content
				</p>
			</div>
		`;
	}

	private async showPreview(chat: Chat) {
		this.previewItem = {
			id: chat.id,
			type: 'chat',
			data: chat,
			category: this.inferChatCategory(chat),
			alreadySynced: false
		};
		const rightPanel = this.contentEl.querySelector('.right-panel') as HTMLElement;
		if (!rightPanel) return;

		rightPanel.innerHTML = `
			<div class="preview-header">Previewing: ${chat.summary || 'Untitled Chat'}</div>
			<div class="loading-spinner">Loading preview...</div>
		`;

		try {
			// Get full chat details if needed
			let fullChat = chat;
			if (!chat.messages || chat.messages.length === 0) {
				fullChat = await this.plugin.api.getChat(chat.id);
			}

			// Generate preview content
			const previewContent = this.plugin.formatSmartChatMarkdown(fullChat);
			const truncatedContent = previewContent.substring(0, 2000) + 
				(previewContent.length > 2000 ? '\n\n... (truncated)' : '');

			rightPanel.innerHTML = `
				<div class="preview-header">
					${chat.summary || 'Untitled Chat'}
					<div style="font-size: 0.8em; font-weight: normal; opacity: 0.8; margin-top: 4px;">
						${new Date(chat.createdAt).toLocaleString()} | ${chat.visibility}
					</div>
				</div>
				<div class="preview-content">
					<div style="background: var(--background-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
						<strong>Target Path:</strong> ${this.plugin.getSmartChatFilePath(chat, this.plugin.settings.chatFolderPath)}
					</div>
					<pre style="white-space: pre-wrap; font-size: 0.85em; line-height: 1.4; background: var(--background-primary-alt); padding: 12px; border-radius: 4px; overflow-y: auto; max-height: 400px;">${truncatedContent}</pre>
				</div>
			`;
		} catch (error) {
			rightPanel.innerHTML = `
				<div class="preview-header">Error Loading Preview</div>
				<div class="preview-content">
					<p style="color: var(--text-error);">Failed to load chat details: ${error.message}</p>
				</div>
			`;
		}
	}

	private clearPreview() {
		this.previewItem = null;
		const rightPanel = this.contentEl.querySelector('.right-panel') as HTMLElement;
		if (rightPanel) {
			this.createPreviewPanel(rightPanel);
		}
	}

	private createActionButtons(containerEl: HTMLElement) {
		const actionContainer = containerEl.createDiv('modal-actions');
		actionContainer.style.display = 'flex';
		actionContainer.style.gap = '12px';
		actionContainer.style.justifyContent = 'space-between';
		actionContainer.style.marginTop = '16px';

		const leftActions = actionContainer.createDiv();
		leftActions.style.display = 'flex';
		leftActions.style.gap = '8px';

		// Selection summary
		const summary = leftActions.createEl('span', {
			text: '0 chats selected',
			cls: 'selection-summary'
		});
		summary.style.alignSelf = 'center';
		summary.style.opacity = '0.7';

		const rightActions = actionContainer.createDiv();
		rightActions.style.display = 'flex';
		rightActions.style.gap = '12px';

		new ButtonComponent(rightActions)
			.setButtonText('Cancel')
			.onClick(() => this.close());

		new ButtonComponent(rightActions)
			.setButtonText('Import Selected')
			.setCta()
			.onClick(async () => {
				if (this.selectedItemIds.size === 0) {
					new Notice('Please select at least one chat to import.');
					return;
				}

				const selectedChats = this.availableChats.filter(chat => 
					this.selectedItemIds.has(chat.id)
				);

				this.close();
				await this.plugin.syncSelectedChats(selectedChats);
			});
	}

	private updateVisualSelection() {
		// Update checkboxes
		const chatItems = this.contentEl.querySelectorAll('.chat-item');
		chatItems.forEach((item) => {
			const chatId = (item as HTMLElement).dataset.chatId;
			const checkbox = item.querySelector('.chat-checkbox') as HTMLInputElement;
			if (checkbox && chatId) {
				checkbox.checked = this.selectedItemIds.has(chatId);
				// Update visual state
				if (checkbox.checked) {
					(item as HTMLElement).classList.add('selected');
				} else {
					(item as HTMLElement).classList.remove('selected');
				}
			}
		});

		// Update selection summary
		const summary = this.contentEl.querySelector('.selection-summary');
		if (summary) {
			const count = this.selectedItemIds.size;
			summary.textContent = `${count} chat${count !== 1 ? 's' : ''} selected`;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// Remove custom styles
		const styleEl = document.querySelector('style');
		if (styleEl && styleEl.textContent?.includes('chat-selection-modal')) {
			styleEl.remove();
		}
	}
}

class LimitlessLifelogsSettingTab extends PluginSettingTab {
	plugin: LimitlessLifelogsPlugin;

	constructor(app: App, plugin: LimitlessLifelogsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your Limitless AI API key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Folder path')
			.setDesc('Where to store the lifelog entries')
			.addText(text => text
				.setPlaceholder('Folder path')
				.setValue(this.plugin.settings.folderPath)
				.onChange(async (value) => {
					this.plugin.settings.folderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Start date')
			.setDesc('Default start date for initial sync (YYYY-MM-DD)')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.startDate)
				.onChange(async (value) => {
					this.plugin.settings.startDate = value;
					await this.plugin.saveSettings();
				}));

		// Chat Settings Section
		containerEl.createEl('h2', {text: 'Chat Settings'});

		new Setting(containerEl)
			.setName('Enable chat sync')
			.setDesc('Sync your Ask AI conversation history')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncChats)
				.onChange(async (value) => {
					this.plugin.settings.syncChats = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Chat folder path')
			.setDesc('Where to store chat conversations')
			.addText(text => text
				.setPlaceholder('Folder path')
				.setValue(this.plugin.settings.chatFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.chatFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Chat file format')
			.setDesc('How to organize chat files')
			.addDropdown(dropdown => dropdown
				.addOptions({
					'per-chat': 'One file per chat',
					'daily': 'Daily chat summaries',
					'monthly': 'Monthly chat archives'
				})
				.setValue(this.plugin.settings.chatFileFormat)
				.onChange(async (value) => {
					this.plugin.settings.chatFileFormat = value as 'daily' | 'per-chat' | 'monthly';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max chats per sync')
			.setDesc('Maximum number of chats to sync at once (1-200)')
			.addSlider(slider => slider
				.setLimits(1, 200, 10)
				.setValue(this.plugin.settings.maxChatsPerSync)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxChatsPerSync = value;
					await this.plugin.saveSettings();
				}));

		// Checkbox Aggregation Settings
		containerEl.createEl('h3', {text: 'Todo Aggregation'});

		new Setting(containerEl)
			.setName('Create checkbox aggregation')
			.setDesc('Collect all checkbox items from chats into a single todo file')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.createCheckboxAggregation)
				.onChange(async (value) => {
					this.plugin.settings.createCheckboxAggregation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Aggregation file name')
			.setDesc('Name of the file where all checkbox items will be collected')
			.addText(text => text
				.setPlaceholder('Todo Aggregation.md')
				.setValue(this.plugin.settings.checkboxAggregationFile)
				.onChange(async (value) => {
					this.plugin.settings.checkboxAggregationFile = value;
					await this.plugin.saveSettings();
				}));
	}
}

class LimitlessAPI {
	private apiKey: string;
	private baseUrl = 'https://api.limitless.ai';
	private batchSize = 10;
	private maxRetries = 5;
	private retryDelay = 1000; // 1 second

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	setApiKey(apiKey: string) {
		this.apiKey = apiKey;
	}

	async getLifelogs(date: Date): Promise<unknown[]> {
		const allLifelogs: unknown[] = [];
		let cursor: string | null = null;

		const params = new URLSearchParams({
			date: date.toISOString().split('T')[0],
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			includeMarkdown: 'true',
			includeHeadings: 'true',
			direction: 'asc',
			limit: this.batchSize.toString()
		});

		do {
			if (cursor) {
				params.set('cursor', cursor);
			}

			try {
				const data = await this.makeRequest(`${this.baseUrl}/v1/lifelogs`, params);
				const responseData = data.data as {lifelogs?: unknown[]} | undefined;
				const lifelogs = responseData?.lifelogs || [];
				allLifelogs.push(...lifelogs);

				const responseMeta = data.meta as {lifelogs?: {nextCursor?: string}} | undefined;
				cursor = responseMeta?.lifelogs?.nextCursor || null;
			} catch (error) {
				console.error('Error fetching lifelogs:', error);
				throw error;
			}
		} while (cursor);

		return allLifelogs;
	}

	async getChats(params: {
		cursor?: string;
		direction?: 'asc' | 'desc';
		limit?: number;
		timezone?: string;
		isScheduled?: boolean;
		globalPromptId?: string;
	}): Promise<{chats: Chat[], meta: unknown}> {
		try {
			const searchParams = new URLSearchParams();
			
			if (params.cursor) searchParams.set('cursor', params.cursor);
			if (params.direction) searchParams.set('direction', params.direction);
			if (params.limit) searchParams.set('limit', params.limit.toString());
			if (params.timezone) searchParams.set('timezone', params.timezone);
			if (params.isScheduled !== undefined) searchParams.set('isScheduled', params.isScheduled.toString());
			if (params.globalPromptId) searchParams.set('globalPromptId', params.globalPromptId);

			const response = await this.makeRequest(`${this.baseUrl}/v1/chats`, searchParams);
			const responseData = response.data as {chats?: Chat[]} | undefined;
			return {
				chats: responseData?.chats || [],
				meta: response.meta
			};
		} catch (error) {
			if (error.status === 404) {
				throw new Error('Chats not found or access denied');
			} else if (error.status === 401) {
				throw new Error('Invalid API key or unauthorized access');
			}
			throw error;
		}
	}

	async getChat(id: string, timezone?: string): Promise<Chat> {
		try {
			const params = new URLSearchParams();
			if (timezone) params.set('timezone', timezone);

			const response = await this.makeRequest(`${this.baseUrl}/v1/chats/${id}`, params);
			return response.data as Chat;
		} catch (error) {
			if (error.status === 404) {
				throw new Error('Chat not found or access denied');
			} else if (error.status === 401) {
				throw new Error('Invalid API key or unauthorized access');
			}
			throw error;
		}
	}

	async deleteChat(id: string): Promise<{success: boolean}> {
		try {
			await requestUrl({
				url: `${this.baseUrl}/v1/chats/${id}`,
				method: 'DELETE',
				headers: {
					'X-API-Key': this.apiKey,
					'Content-Type': 'application/json'
				}
			});
			return {success: true};
		} catch (error) {
			if (error.status === 404) {
				throw new Error('Chat not found or access denied');
			} else if (error.status === 401) {
				throw new Error('Invalid API key or unauthorized access');
			}
			throw error;
		}
	}

	private async makeRequest(url: string, params: URLSearchParams): Promise<{data?: unknown; meta?: unknown}> {
		let retries = 0;
		const maxRetries = this.maxRetries;
		
		while (retries <= maxRetries) {
			try {
				const response = await requestUrl({
					url: `${url}?${params.toString()}`,
					method: 'GET',
					headers: {
						'X-API-Key': this.apiKey,
						'Content-Type': 'application/json'
					}
				});

				if (!response.json) {
					throw new Error('Invalid response format');
				}

				return response.json as {data?: unknown; meta?: unknown};
			} catch (error) {
				if (error.status === 429 && retries < maxRetries) {
					let delay = this.retryDelay * Math.pow(2, retries);
					const retryAfter = error.headers?.['retry-after'];

					if (retryAfter) {
						const retryAfterSeconds = parseInt(retryAfter, 10);
						if (!isNaN(retryAfterSeconds)) {
							delay = retryAfterSeconds * 1000;
						} else {
							const retryAfterDate = new Date(retryAfter);
							const now = new Date();
							delay = retryAfterDate.getTime() - now.getTime();
						}
					}

					new Notice(`Rate limit exceeded. Retrying in ${Math.round(delay / 1000)} seconds...`);
					await new Promise(resolve => setTimeout(resolve, delay));
					retries++;
				} else {
					console.error('Error making request:', error);
					throw error;
				}
			}
		}
		throw new Error('Maximum retry attempts exceeded');
	}
}
