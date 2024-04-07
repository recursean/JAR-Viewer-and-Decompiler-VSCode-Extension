// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import * as JSZip from 'jszip';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "jar-viewer-and-decompiler" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('jar-viewer-and-decompiler.viewJarContents', viewJarContents);

	context.subscriptions.push(disposable);

	let disposable2 = vscode.commands.registerCommand('jar-viewer-and-decompiler.openFile', openFile);

    context.subscriptions.push(disposable2);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Parse and display contents of JAR file
function viewJarContents(uri: vscode.Uri) {
	if (!uri) {
		vscode.window.showWarningMessage('No JAR file selected.');
		return;
	}

	// Now you have the URI of the selected JAR file, you can work with it
	const jarFilePath = uri.fsPath;
	console.log(`Selected JAR File: ${jarFilePath}`);

	// You can then pass this path to your logic that handles the opening and displaying of the JAR contents
	// await openAndDisplayJarContents(jarFilePath);

	// Bring the JAR Explorer view into focus
	vscode.commands.executeCommand('workbench.view.extension.jarViewer').then(() => {
		// Optionally, you can also select a specific item in your custom view here
	});

	const jarContentProvider = new JarContentProvider(uri);
    vscode.window.registerTreeDataProvider('jarContents', jarContentProvider);
}

async function openFile(filePath: string, jarFile: JSZip) {
	try {
		// Convert the file path to a Uri
		// const fileUri = vscode.Uri.file(filePath);
		// console.log("opening " + fileUri);
		console.log("opening " + filePath);

		var file = jarFile.file(filePath);
		if(file) {
			var fileContents = await file.async("string");
			const document = await vscode.workspace.openTextDocument({
				content: fileContents,
				language: "plaintext"
			});

			// Show the text document in a VS Code editor
			await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
		}

		// Open the text document referred by the Uri
		// const document = await vscode.workspace.openTextDocument(fileUri);

	} catch (error) {
		vscode.window.showErrorMessage(`Could not open file: ${error}`);
	}
}
// async function openAndDisplayJarContents(jarFilePath: string) {
//     // Implement the logic to read and display the contents of the JAR file
//     // This could involve parsing the JAR file, decompiling classes, etc.
// }

/**
 * Class responsible for the file directory tree of the JAR file in
 * the VSCode explorer view.
 */
class JarContentProvider implements vscode.TreeDataProvider<JarEntry> {
    private _onDidChangeTreeData: vscode.EventEmitter<JarEntry | undefined | null> = new vscode.EventEmitter<JarEntry | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<JarEntry | undefined | null> = this._onDidChangeTreeData.event;
	
	jarFilePath: string;
	jarFileName: string;
	jarFile: JSZip | null = null;

	jarMap: Map<string, GraphNode>;

    constructor(private uri: vscode.Uri) {
		// Save file path
		this.jarFilePath = uri.fsPath;

		// Parse jar file name
		var parts = this.jarFilePath.split("/");
		if(parts.length > 0) {
			this.jarFileName = parts[parts.length - 1];
		}
		else {
			this.jarFileName = "<error reading jar>";
		}
		this.jarMap = new Map<string, GraphNode>();
		this.parseJarFile();
	}

    getTreeItem(element: JarEntry): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JarEntry): Thenable<JarEntry[]> {
        if (element) {
            // If we have an element, return its children
            return Promise.resolve(this.getEntries(element.label));
        } else {
            // If no element is provided, return the root level entries
            return Promise.resolve(this.getRootEntries());
        }
    }

	/**
	 * 
	 * Logic to parse the root entries of the JAR file. 
	 * For this extension, the root entry will always 
	 * be the name of JAR file.
	 * 
	 * @returns JarEntry with JAR file name as label
	 */
    private getRootEntries(): JarEntry[] {
		// Root entry will always be the name of jar file
    	return [new JarEntry(
			this.jarFileName, // Label to display
			this.jarFilePath, // Label to display
			vscode.TreeItemCollapsibleState.Collapsed // Indicates that it can be expanded to show child items
		)];
    }

    private getEntries(path: string): JarEntry[] {
		var entries: JarEntry[] = [];
		
		var n: GraphNode | undefined;
		// Determine if we are operating on root of jar
		if(path === this.jarFileName) {
			n = this.jarMap.get(this.jarFilePath);
		}
		else {
			n = this.jarMap.get(path + "/");
		}
		
		if(n) {
			var jarFilelocal = this.jarFile;
			n.children.forEach(function (child) {
				if(child.dir) {
					const entry = new JarEntry(
						child.fileName, // Label to display
						child.filePath,
						vscode.TreeItemCollapsibleState.Collapsed // Indicates that it can be expanded to show child items
					);
					entries.push(entry);
				}
				else {
					const entry = new JarEntry(
						child.fileName, // Label to display
						child.filePath,
						vscode.TreeItemCollapsibleState.None,
						{
							command: 'jar-viewer-and-decompiler.openFile', // Command to execute when this item is clicked
							title: "Open File", // Title of the command, not used in the tree view but required
							arguments: [child.filePath, jarFilelocal] // Arguments to pass to the command handler
						}
					);
					entries.push(entry);
				}
			});

		}

		return entries;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }

	async parseJarFile() {
		// Create root node for jar file
		this.jarMap.set(this.jarFilePath, new GraphNode(this.jarFileName, true));

		// Parse jar file
		try {
			// Read the content of the JAR file
			const jarData = await vscode.workspace.fs.readFile(this.uri);
			
			// Load the JAR file data with JSZip
			this.jarFile = (await JSZip.loadAsync(jarData)) as unknown as JSZip;
			
			// Iterate through the contents of the JAR file
			this.jarFile?.forEach((relativePath, zipEntry) => {
				// Add new node to map for this entry
				var n = new GraphNode(zipEntry.name, zipEntry.dir);
				this.jarMap.set(zipEntry.name, n);

				var parts = zipEntry.name.split("/");
				// Is this entry at root level of jar?
				if( (parts.length === 2 && zipEntry.dir) || (parts.length === 1) ) {
					var root = this.jarMap.get(this.jarFilePath);
					if(root) {
						root.children.push(n);
					}
				}
				else {
					var parent = parts.splice(0, parts.length - 1).join("/") + "/";
					var parentNode = this.jarMap.get(parent);
					if(parentNode) {
						parentNode.children.push(n);
					}
				}
			});
		} catch (error) {
			console.error(`Failed to parse JAR file: ${error}`);
			// vscode.window.showErrorMessage(`Failed to parse JAR file: ${error.message}`);
		}
	}
}

class GraphNode {
	fileName: string;
	filePath: string;
	children: GraphNode[];
	dir: boolean;
	constructor(filePath: string, dir: boolean) {
		this.filePath = filePath;
		this.children = [];
		this.dir = dir;
		this.fileName = "";
		// Parse file name
		var parts = this.filePath.split("/");
		if(parts.length > 0) {
			if(dir) {
				this.fileName = parts[parts.length - 2];
			}
			else {
				this.fileName = parts[parts.length - 1];
			}
		}
	}
}

class JarEntry extends vscode.TreeItem {
    constructor(
		// Add a command that is executed when the tree item is activated
        public readonly label: string,
        public readonly path: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
		// ?: vscode.Command = {
		// 	command: 'yourExtension.openFile', // The command ID
		// 	title: '', // Title is not used here but is required
		// 	arguments: [/* pass necessary arguments here, e.g., the file path */]
		// }
    ) {
        super(label, collapsibleState);
    }
}