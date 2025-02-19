import { Plugin, TAbstractFile, TFile, TFolder, Notice, PluginSettingTab, App, Setting } from 'obsidian';

export default class BookmarkGeneratorPlugin extends Plugin {
    //private lang: any;

    // Check if the item is a hidden file or directory
    private isHidden(item: TAbstractFile): boolean {
        return item.name.startsWith('.');
    }

    // Check if the file is a markdown file
    private isMarkdownFile(file: TFile): boolean {
        return file.extension === 'md';
    }

    // Get the creation time of a file or directory
    private async getCreationTime(item: TFile | TFolder): Promise<number> {
        try {
            const stat = await this.app.vault.adapter.stat(item.path);
            return stat?.ctime ? stat.ctime * 1000 : 0;
        } catch (err) {
            console.warn(`Failed to get creation time for ${item.path}, using 0 instead`);
            return 0;
        }
    }

    // Process a folder and generate bookmark nodes
    private async processFolder(folder: TFolder): Promise<any | null> {
        const title = folder.name;
        const ctime = await this.getCreationTime(folder);
        const items: any[] = [];

        const children = folder.children.filter(child => {
            return !this.isHidden(child);
        });

        children.sort((a, b) => a.name.localeCompare(b.name));

        for (const child of children) {
            if (child instanceof TFolder) {
                const processedChild = await this.processFolder(child);
                if (processedChild) items.push(processedChild);
            } else if (child instanceof TFile && this.isMarkdownFile(child)) {
                items.push({
                    type: 'file',
                    ctime: await this.getCreationTime(child),
                    path: child.path,
                });
            }
        }
        if (items.length === 0) {
            return null;
        }
        return {
            type: 'group',
            ctime: ctime,
            title: title,
            path: folder.path,
            items: items,
        };
    }

    // Generate the bookmark file
    public async generateBookmark(merge: boolean) {
        const vault = this.app.vault;
        const bookmark: any = { items: [] };

        const rootFolder = vault.getRoot();
        const children = rootFolder.children.filter(child => {
            return !this.isHidden(child);
        });

        children.sort((a, b) => a.name.localeCompare(b.name));

        for (const child of children) {
            if (child instanceof TFolder) {
                const processedFolder = await this.processFolder(child);
                if (processedFolder) {
                    bookmark.items.push(processedFolder);
                }
            } else if (child instanceof TFile && this.isMarkdownFile(child)) {
                bookmark.items.push({
                    type: 'file',
                    ctime: await this.getCreationTime(child),
                    path: child.path,
                });
            }
        }

        const fileName = 'bookmarks.json';
        const obsidianFolder = '.obsidian';
        const filePath = `${obsidianFolder}/${fileName}`;
        let finalBookmark = bookmark;

        if (merge) {
            try {
                const exists = await vault.adapter.exists(filePath);
                if (exists) {
                    const oldContent = await vault.adapter.read(filePath);
                    const oldBookmark = JSON.parse(oldContent);
                    finalBookmark.items = this.mergeItemLists(oldBookmark.items || [], bookmark.items);
                }
            } catch (err) {
                console.error('Failed to read or parse old bookmarks.json, using newly generated structure', err);
            }
        }

        const jsonContent = JSON.stringify(finalBookmark, null, 2);

        try {
            await vault.adapter.write(filePath, jsonContent);
            new Notice(`Bookmark file generated: ${filePath}`);
        } catch (err) {
            console.error(err);
            new Notice(`Failed to generate bookmark file: ${err}`);
        }
    }

    // Merge bookmark item lists, preserving original order
    private mergeItemLists(oldItems: any[], newItems: any[]): any[] {
        const result: any[] = [];
        const newMap = new Map<string, any>();

        const getKey = (item: any) => {
            return (item.type === 'file' ? 'file:' : 'group:') + item.path;
        };

        newItems.forEach(item => {
            newMap.set(getKey(item), item);
        });

        const processedKeys = new Set<string>();

        for (const oldItem of oldItems) {
            const key = getKey(oldItem);
            if (newMap.has(key)) {
                const newItem = newMap.get(key);
                if (oldItem.type === 'group' && newItem.type === 'group') {
                    newItem.items = this.mergeItemLists(oldItem.items || [], newItem.items || []);
                }
                result.push(newItem);
                processedKeys.add(key);
            }
        }

        for (const newItem of newItems) {
            const key = getKey(newItem);
            if (!processedKeys.has(key)) {
                result.push(newItem);
            }
        }

        return result;
    }

    // Initialization when the plugin is loaded
    onload() {
        this.addCommand({
            id: 'generate-bookmark',
            name: 'Generate Bookmark File',
            callback: () => this.generateBookmark(true),
        });
        this.addRibbonIcon('bookmark-check', 'Generate Bookmark File', () => this.generateBookmark(true));
        this.addSettingTab(new BookmarkGeneratorSettingTab(this.app, this));
    }

    // Cleanup when the plugin is unloaded
    onunload() {
        // Cleanup when the plugin is unloaded
    }
}


class BookmarkGeneratorSettingTab extends PluginSettingTab {
    plugin: BookmarkGeneratorPlugin;

    constructor(app: App, plugin: BookmarkGeneratorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Regenerate Bookmark File")
            .setDesc("Click the button to regenerate the bookmarks.json file without merging existing content.")
            .addButton((button) =>
                button
                    .setButtonText("Regenerate")
                    .onClick(async () => {
                        await this.plugin.generateBookmark(false);
                    })
            );
    }
}