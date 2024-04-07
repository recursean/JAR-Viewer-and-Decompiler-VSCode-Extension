import * as vscode from 'vscode';
import * as JSZip from 'jszip';

/**
 * 
 *  SECTION: global vars
 * 
 */

// scheme used when opening files in editor view
const scheme = 'jar-viewer-and-decompiler';

// global var used to share contents of file with editor view
var fileContents = "";

/**
 * 
 *  SECTION: Extension activation and deactivation
 * 
 */

/**
 * Main activation method for extension. Called when first interaction
 * with extension occurs. 
 * @param context 
 */
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.viewJarContents', viewJarContents));
	context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.openFile', openFile));

	// Prepare and register document provider for opening files 
	// in editor.
	const provider = new TextDocumentContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, provider));
}

/**
 * This method is called when extension is deactivated.
 */
export function deactivate() {}

/**
 * 
 *  SECTION: Extension commands registered in activate()
 * 
 */

/**
 * Parse and display contents of JAR file. Called when user
 * right clicks on .jar file in file explorer and selects
 * option to launch this extension.
 * 
 * @param uri file that was selected to be viewed
 */
function viewJarContents(uri: vscode.Uri) {
	if (!uri) {
		vscode.window.showWarningMessage('No JAR file selected.');
		return;
	}

	// bring this extension into focus
	vscode.commands.executeCommand('workbench.view.extension.jarViewer').then(() => {});

	// build content to display in extension view 
	const jarContentProvider = new JarContentProvider(uri);
    vscode.window.registerTreeDataProvider('jarContents', jarContentProvider);
}

/**
 * Called when a file in the jar file is selected to be opened.
 * This will open a local copy of the file in the editor view. 
 * 
 * @param filePath path to selected file in jar
 * @param jarFile JSZip object containing selected jar file contents
 * @param jarFileName name of jar file
 */
async function openFile(filePath: string, jarFile: JSZip, jarFileName: string) {
	try {
		var file = jarFile.file(filePath);
		if(file) {
			// read contents of selected file
			fileContents = await file.async("string");

			var parts = filePath.split(".");
			// was a java class file selected?
			if(parts[parts.length - 1] === 'class') {
				// Retrieve the path to the CFR JAR file from the extension settings
				const cfrPath = vscode.workspace.getConfiguration().get<string>('jar-viewer-and-decompiler.cfrPath');
				
				// Construct the Java command
				// const command = `java -jar ${cfrPath} ${classFilePath}`;
			
				// cp.exec(command, (error, stdout, stderr) => {
				// 	if (error) {
				// 		console.error(`exec error: ${error}`);
				// 		return vscode.window.showErrorMessage('Decompilation error: ' + error.message);
				// 	}
			
				// 	// Handle the decompiled Java code in `stdout`
				// 	console.log(`Decompiled code: ${stdout}`);
			
				// 	// Optionally, show the decompiled code in a new VS Code editor tab
				// 	vscode.workspace.openTextDocument({ content: stdout, language: 'java' }).then(doc => {
				// 		vscode.window.showTextDocument(doc);
				// 	});
				// });
			}
			else {
				// show contents of file in editor viewer
				const uri = vscode.Uri.parse(`${scheme}:///${jarFileName}/${filePath}`);
				const doc = await vscode.workspace.openTextDocument(uri); 
				await vscode.window.showTextDocument(doc, { preview: true });
			}
		}
	} catch (error) {
		vscode.window.showErrorMessage(`Could not open file: ${error}`);
	}
}

/**
 * 
 *  SECTION: Classes
 * 
 */

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

	/**
	 * Return files and directories in the selected 
	 * directory. This method will only ever be called 
	 * for collapsable entries.
	 * 
	 * @param path path to directory that was selected
	 * @returns 
	 */
    private getEntries(path: string): JarEntry[] {
		// entries that will be returned
		var entries: JarEntry[] = [];
		
		// node in graph for selected directory
		var n: GraphNode | undefined;

		// Determine if we are operating on root of jar
		if(path === this.jarFileName) {
			n = this.jarMap.get(this.jarFilePath);
		}
		else {
			n = this.jarMap.get(path + "/");
		}
		
		if(n) {
			// create local vars for sharing in arguments to openFile
			var jarFilelocal = this.jarFile;
			var jarFileNameLocal = this.jarFileName;

			// create an entry for each child of selected directory
			n.children.forEach(function (child) {
				// create collapsable entry for directories
				if(child.dir) {
					const entry = new JarEntry(
						child.fileName, 
						child.filePath,
						vscode.TreeItemCollapsibleState.Collapsed 
					);
					entries.push(entry);
				}
				// create openable entries for files
				else {
					const entry = new JarEntry(
						child.fileName,
						child.filePath,
						vscode.TreeItemCollapsibleState.None,
						{
							command: 'jar-viewer-and-decompiler.openFile', 
							title: "Open File",
							arguments: [child.filePath, jarFilelocal, jarFileNameLocal] 
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

	/**
	 * Use JSZip to loop through contents of jar file and build
	 * graph representation of contents. Files and directories are 
	 * represented by nodes. Each node can have 0 or more children 
	 * nodes. To store the graph, a hash map is used where the key
	 * is the name of the file/dir and the value is the node. 
	 * 
	 * This is done once when a jar file is first selected.
	 */
	private async parseJarFile() {
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
					// add current node to children of root node
					var root = this.jarMap.get(this.jarFilePath);
					if(root) {
						root.children.push(n);
					}
				}
				else {
					// get parent node and add current node as a child
					var parent = parts.splice(0, parts.length - 1).join("/") + "/";
					var parentNode = this.jarMap.get(parent);
					if(parentNode) {
						parentNode.children.push(n);
					}
				}
			});
		} catch (error) {
			console.error(`Failed to parse JAR file: ${error}`);
			vscode.window.showErrorMessage(`Failed to parse JAR file: ${error}`);
		}
	}
}

/**
 * Represents a file or directory in jar content directory view.
 */
class JarEntry extends vscode.TreeItem {
    constructor(
		// name to display in directory view
        public readonly label: string,

		// full path to file or dir in jar file
        public readonly path: string,

		// none if file, collapsed if dir
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,

		// command to execute when this entry is selected
		public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
    }
}

/**
 * Contents of jar is stored in a graph data structure used to easily
 * display the contents in the directory tree view. Each node is a 
 * file or directory in the jar and can have 0 or more children nodes. 
 */
class GraphNode {
	// name of file or dir
	fileName: string;

	// full path to file or dir in jar
	filePath: string;

	// files or dirs one level deeper than this node
	children: GraphNode[];

	// true if directory, false if file
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

/**
 * This class is used when vscode.workspace.openTextDocument(uri) is called
 * to open a selected file from the jar file. 
 */
class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        // return most recent file that was read 
        return fileContents;
    }
}