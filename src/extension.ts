import * as vscode from 'vscode';
import * as JSZip from 'jszip';
import * as cp from 'child_process';

const os = require('os');

/**
 * 
 *  MARK: global vars
 * 
 */

// scheme used when opening files in editor view
const scheme = 'jar-viewer-and-decompiler';

// default CFR output size (KBs)
const CFR_OUTPUT_SIZE_DEFAULT = 250;

// global var used to share contents of file with editor view
var fileContents = "";

var searchView: JarFilterProvider;
var documentProvider: TextDocumentContentProvider;

var debug = false;

/**
 * 
 *  MARK: Extension activation and deactivation
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
    context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.printSignatures', printSignatures));
    context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.search', search));
    context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.searchRegex', searchRegex));
    context.subscriptions.push(vscode.commands.registerCommand('jar-viewer-and-decompiler.reset', reset));

    vscode.window.createTreeView('jarContents', {
        treeDataProvider: new JarContentProvider(undefined),
        showCollapseAll: false
    });

    vscode.window.createTreeView('jarSearch', {
        treeDataProvider: new JarFilterProvider(undefined),
        showCollapseAll: false
    });
    
    // Prepare and register document provider for opening files 
    // in editor.
    documentProvider = new TextDocumentContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, documentProvider));
}

/**
 * This method is called when extension is deactivated.
 */
export function deactivate() {}

/**
 * 
 *  MARK: Extension commands registered in activate()
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
    vscode.window.createTreeView('jarContents', {
        treeDataProvider: jarContentProvider,
        showCollapseAll: true,
    });
}

/**
 * Called when a file in the jar file is selected to be opened.
 * This will open a local copy of the file in the editor view. 
 * 
 * @param filePath path to selected file in jar
 * @param jarFile JSZip object containing selected jar file contents
 * @param jarFileName name of jar file
 */
async function openFile(filePath: string, jarFile: JSZip, jarFileName: string, jarFilePath: string) {
    try {
        var file = jarFile.file(filePath);
        if(file) {
            // used for opening file in editor
            const uri = vscode.Uri.parse(`${scheme}:///${jarFileName}/${filePath}`);

            var parts = filePath.split(".");
            // was a java class file selected?
            if(parts[parts.length - 1] === 'class') {
                // get path to CFR JAR file from extension settings
                const cfrPath = vscode.workspace.getConfiguration().get<string>(
                    'jar-viewer-and-decompiler.cfrPath'
                );
                
                // get specified size for CFR output from extension settings
                const cfrOutputSize = vscode.workspace.getConfiguration().get<number>(
                    'jar-viewer-and-decompiler.cfrOutputSize') ?? CFR_OUTPUT_SIZE_DEFAULT;

                // open empty document as placeholder until CFR returns
                fileContents = '';
                const doc = await vscode.workspace.openTextDocument(uri);                     
                await vscode.languages.setTextDocumentLanguage(doc, 'java');
                const editor = await vscode.window.showTextDocument(doc, { preview: true });

                // run CFR to decompile selected class file
                const command = `java -jar ${cfrPath} --extraclasspath ${jarFilePath} ${filePath}`;                
                cp.exec(command, {maxBuffer: 1024 * cfrOutputSize}, async (error, stdout, stderr) => {
                    if (error) {
                        console.error(`CFR error: ${error}`);
                        return vscode.window.showErrorMessage('Decompilation error: ' + error.message);
                    }

                    if(stderr.length > 0) {
                        console.error(`CFR error: ${stderr}`);
                    }

                    // set file contents to output of cfr
                    fileContents = stdout;
            
                    // show contents of file in editor viewer
                    documentProvider.updateContent(uri);
                });
            }
            else {
                // read contents of selected file
                fileContents = await file.async("string");
        
                // show contents of file in editor viewer
                const doc = await vscode.workspace.openTextDocument(uri); 
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Could not open file: ${error}`);
    }
}

/**
 * Called when a user right clicks on a class file in jar viewer.
 * This invokes the javap -s command to get the signatures and
 * opens the output in the editor view.
 * 
 * @param jarEntry selected class file from jar viewer
 */
async function printSignatures(jarEntry: JarEntry) {
    // arguments come from selected JarEntry entry
    var jarFilePath = jarEntry.command?.arguments![3];

    // javap requires .class extension be removed 
    var classFileName = jarEntry.command?.arguments![0];
    classFileName = classFileName.substring(0, classFileName.length - 6);

    // run javap to print type signatures for selected class file
    const command = `javap -s -cp ${jarFilePath} ${classFileName}`;
    cp.exec(command, async (error, stdout, stderr) => {
        if (error) {
            console.error(`javap error: ${error}`);
            return vscode.window.showErrorMessage('Type signature error: ' + error.message);
        }

        if(stderr.length > 0) {
            console.error(`javap error: ${stderr}`);
        }

        // set file contents to output of cfr
        fileContents = stdout;

        // used for opening file in editor
        const uri = vscode.Uri.parse(`${scheme}:///signatures/${jarEntry.command?.arguments![0]}`);

        // show contents of file in editor viewer
        const doc = await vscode.workspace.openTextDocument(uri); 

        await vscode.window.showTextDocument(doc, { preview: true });
    });
}

/**
 * Prompts user for fully qualified package name to
 * search for in the JAR file.
 */
async function search() {
    // return early if no jar file has been selected
    if(!searchView) {
        return;
    }

    const searchQuery = await vscode.window.showInputBox({
        prompt: "Enter fully qualified package",
        placeHolder: "Search for Java package"
    });

    if(searchQuery) {
        searchView.filterPackages(searchQuery, false);
    }
}

/**
 * Prompts user for regular expression search.
 */
async function searchRegex() {
    // return early if no jar file has been selected
    if(!searchView) {
        return;
    }

    const searchQuery = await vscode.window.showInputBox({
        prompt: "Enter package regular expression",
        placeHolder: "Search for Java package"
    });

    if(searchQuery) {
        searchView.filterPackages(searchQuery, true);
    }
}

/**
 * Resets the search view to display an unfiltered list.
 */
async function reset() {
    // return early if no jar file has been selected
    if(!searchView) {
        return;
    }
    
    searchView.reset();
}

/**
 * 
 *  MARK: Classes
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

    packages: GraphNode[];

    constructor(private uri: vscode.Uri | undefined) {
        // init
        this.jarMap = new Map<string, GraphNode>();
        this.packages = [];
        this.jarFileName = "";
        this.jarFilePath = "";

        // return early if no jar selected
        if(!uri) {
            return;
        }

        // Save file path
        this.jarFilePath = uri.fsPath;

        if(debug) {
            console.log("Processing JAR file: " + this.jarFilePath);
        }

        // replace forward slashes and back slashes on Windows
        if(os.platform() === 'win32') {
            this.jarFilePath = this.jarFilePath.replace(/\\/g, '/');

            if(debug) {
                console.log("New Windows JAR path: " + this.jarFilePath);
            }
        }

        var parts = this.jarFilePath.split("/");

        if(parts.length > 0) {
            this.jarFileName = parts[parts.length - 1];
            this.parseJarFile().then(result => {
                // display search view
                searchView = new JarFilterProvider(this);
                var filterView = vscode.window.createTreeView('jarSearch', {
                    treeDataProvider: searchView,
                    showCollapseAll: true,
                });
            });
        }
    }

    getTreeItem(element: JarEntry): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JarEntry): Thenable<JarEntry[]> {
        // return early if no jar selected
        if(!this.uri) {
            return Promise.resolve([]);
        }

        if(element) {
            // If we have an element, return its children
            return Promise.resolve(this.getEntries(element, false));
        } 
        else {
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
    getRootEntries(): JarEntry[] {
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
   getEntries(selectedEntry: JarEntry, fromSearch: boolean): JarEntry[] {
        // entries that will be returned
        var entries: JarEntry[] = [];
        
        // node in graph for selected directory
        var n: GraphNode | undefined;

        // Determine if we are operating on root of jar
        if(selectedEntry.label === this.jarFileName) {
            n = this.jarMap.get(this.jarFilePath);
        }
        else {
            n = this.jarMap.get(selectedEntry.path);
            
            if(debug) {
                console.log('Getting entries for: ' + selectedEntry.path);
            }
        }
        

        if(n) {
            if(debug) {
                console.log('Processing entries for dir: ' + n.filePath + " name: " + n.fileName);
            }

            // create local vars for sharing in arguments to openFile
            var jarFilelocal = this.jarFile;
            var jarFileNameLocal = this.jarFileName;
            var jarFilePathLocal = this.jarFilePath;
            
            // create an entry for each child of selected directory
            n.children.forEach(function (child) {
                // create collapsable entry for directories
                if(child.isDir && !fromSearch) {
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
                            arguments: [child.filePath, jarFilelocal, jarFileNameLocal, jarFilePathLocal] 
                        }
                    );
                    // determine if this is a class file
                    if(child.isClassFile) {
                        entry.contextValue = "classfile";
                    }
                    // skip adding entry if coming from search and not a class file
                    else if(fromSearch) {
                        return;
                    }
                    entries.push(entry);
                }
            });

        }

        return entries;
    }
    
    getRootPackageEntries(): JarEntry[] {
        // entries that will be returned
        var entries: JarEntry[] = [];

        this.packages.forEach(function (child) {
            const entry = new JarEntry(
                child.package, 
                child.filePath,
                vscode.TreeItemCollapsibleState.Collapsed 
            );
            entries.push(entry);
        });

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
            const jarData = await vscode.workspace.fs.readFile(this.uri!);
            
            // Load the JAR file data with JSZip5
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
                    if(zipEntry.dir) {
                        var parent = parts.splice(0, parts.length - 2).join("/") + "/";
                    }
                    else {
                        var parent = parts.splice(0, parts.length - 1).join("/") + "/";
                    }
                    var parentNode = this.jarMap.get(parent);
                    if(debug) {
                        console.log('Adding to parent: ' + parent + " child: " + zipEntry.name);
                    }
                    if(parentNode) {
                        parentNode.children.push(n);

                        // if class file, mark parent node as Java package
                        if(n.isClassFile && !parentNode.isPackage) {
                            parentNode.setPackage(true);
                            this.packages.push(parentNode);
                        }
                    }
                }
            });

            if(debug) {
                this.jarMap.forEach((val: GraphNode, key: string) => {
                    console.log(`Key: ${key} Value- name: ${val.fileName} path: ${val.filePath}`);
                });
            }

            this.packages.sort((a: GraphNode, b: GraphNode) => {
                return a.filePath.localeCompare(b.filePath);
            });
        } catch (error) {
            console.error(`Failed to parse JAR file: ${error}`);
            vscode.window.showErrorMessage(`Failed to parse JAR file: ${error}`);
        }
    }
}

class JarFilterProvider implements vscode.TreeDataProvider<JarEntry> {
    private _onDidChangeTreeData: vscode.EventEmitter<JarEntry | undefined | null | void> = new vscode.EventEmitter<JarEntry | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<JarEntry | undefined | null | void> = this._onDidChangeTreeData.event;

    // unfiltered list of packages
    packages: GraphNode[];

    constructor(private jarContentProvider: JarContentProvider | undefined) {
        if(!jarContentProvider) {
            this.packages = [];
            return;
        }

        // store unfiltered list of packages
        this.packages = this.jarContentProvider!.packages;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: JarEntry): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JarEntry): Thenable<JarEntry[]> {
        // return early if no jar file selected
        if(!this.jarContentProvider) {
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve(this.jarContentProvider!.getEntries(element, true));
        } 
        else {
            // If no element is provided, return the root level entrie
            return Promise.resolve(this.jarContentProvider!.getRootPackageEntries());
        }
    }

    /**
     * Filters view to only displays classes and packages that match the search
     * query.
     * 
     * @param searchQuery Fully qualified class file to search
     * @param isRegex true if searchQuery is a regular expression
     */
    filterPackages(searchQuery: string, isRegex: boolean) {
        // normal substring search
        if(!isRegex) {
            this.jarContentProvider!.packages = this.packages.filter(entry => entry.package.includes(searchQuery));
        }
        // regular expression search
        else {
            this.jarContentProvider!.packages = this.packages.filter(entry => {
                try {
                    const regex = new RegExp(searchQuery); 
                    return regex.test(entry.package); 
                }
                catch (error) {
                    console.error("Invalid search regular expression:", error);
                    return [];
                }
            });
        }

        this.refresh();
    }
    
    /**
     * Reset to unfiltered view.
     */
    reset() {
        if(this.jarContentProvider) {
            this.jarContentProvider.packages = this.packages;
        }
        this.refresh();
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

    // fully qualified Java path. this is file path with . delims
    package: string;

    // files or dirs one level deeper than this node
    children: GraphNode[];

    // true if directory, false if file
    isDir: boolean;
    
    // true if Java .class file, false otherwise
    isClassFile: boolean;

    // true if Java package, false otherwise
    isPackage: boolean;

    constructor(filePath: string, dir: boolean) {
        this.filePath = filePath;
        this.children = [];
        this.isDir = dir;
        this.fileName = "";
        this.package = "";
        this.isClassFile = false;
        this.isPackage = false;

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

        // determine if class file
        if(!dir) {
            var nameParts = this.fileName.split(".");
            if(nameParts[nameParts.length - 1] === 'class') {
                this.isClassFile = true;
                this.package = this.filePath.replaceAll("/",".").substring(0, this.filePath.length-1);
            }
        }

        if(debug) {
            console.log("New GraphNode dir: " + this.filePath + " name: " + this.fileName);
        }
    }

    /**
     * Set status of isPackage and set package name. Package name is just file 
     * path with slash delimiters replaced with periods.
     * 
     * @param isPackage true if this node represents a package
     */
    setPackage(isPackage: boolean) {
        this.isPackage = isPackage;
        if(isPackage) {
            this.package = this.filePath.replaceAll("/",".").substring(0, this.filePath.length-1);
        }
        else {
            this.package = "";
        }
    }
}

/**
 * This class is used when vscode.workspace.ouripenTextDocument(uri) is called
 * to open a selected file from the jar file. 
 */
class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        // return most recent file that was read 
        return fileContents;
    }

    // Method to notify listeners of content change
    updateContent(uri: vscode.Uri) {
        this.onDidChangeEmitter.fire(uri);
    }
}