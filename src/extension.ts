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

// used to handle opening of files in JAR
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

                // CFR command to decompile selected class file
                const command = `java -jar ${cfrPath} --extraclasspath "${jarFilePath}" ${filePath}`;

                // display progress message while CFR is running
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Decompiling...",
                        cancellable: true,
                    },
                    async (progress, token) => {
                        return new Promise<void>((resolve) => {
                            // run CFR to decompile selected class file
                            const cfrProcess = cp.exec(command, {maxBuffer: 1024 * cfrOutputSize}, async (error, stdout, stderr) => {
                                if(error) {
                                    console.error(`CFR error: ${error}`);
                                    if(token.isCancellationRequested) {
                                        vscode.window.showWarningMessage("Decompilation cancelled.");
                                    }
                                    else if(error.message.includes("stdout maxBuffer length exceeded")) {
                                        // create link to cfrOutputSize setting
                                        const cfrOutputSizeLink = vscode.Uri.parse(
                                            `command:workbench.action.openSettings?${encodeURIComponent(
                                                '"jar-viewer-and-decompiler.cfrOutputSize"'
                                            )}`
                                        );

                                        // display error message with link to setting
                                        vscode.window.showErrorMessage(
                                            `Decompilation error. Try increasing the
                                            [cfrOutputSize](${cfrOutputSizeLink}) setting for this extension.
                                            ${error.message}`
                                        );
                                    }
                                    else {
                                        vscode.window.showErrorMessage('Decompilation error: ' + error.message);
                                    }
                                }

                                if(stderr.length > 0) {
                                    console.error(`CFR stderr: ${stderr}`);
                                }

                                // hide progress bar
                                resolve();

                                // display file if CFR process was not cancelled by user
                                if(!token.isCancellationRequested) {
                                    // set file contents to output of cfr
                                    fileContents = stdout;

                                    // show contents of file in editor viewer
                                    documentProvider.updateContent(uri);
                                }
                            });

                            // handle cancellation of CFR process by user
                            token.onCancellationRequested(() => {
                                cfrProcess.kill();
                                resolve();
                            });
                        });
                    }
                );
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

    private createMap(list: Map<string, FileEntry>): void {
        this.clearMap();

        // Create root node for jar file
        var root = new GraphNode(this.jarFileName, true);
        this.jarMap.set(this.jarFilePath, root);
        if(debug) {
            console.log(`Processing root entry: ` + this.jarFilePath + `, new node: ` + root.toString());
        }

        // Iterate through the contents of the JAR file
        list?.forEach((item: FileEntry, key: string) => {
            // Add new node to map for this entry
            var n = new GraphNode(item.name, item.dir);
            this.jarMap.set(item.name, n);
            if(debug) {
                console.log(`Processing entry: new node: ` + n.toString());
            }

            var parts = item.name.split("/");
            // Is this entry at root level of jar?
            if( (parts.length === 2 && item.dir) || (parts.length === 1) ) {
                // add current node to children of root node
                var root = this.jarMap.get(this.jarFilePath);
                if(root) {
                    root.children.push(n);
                    if(debug) {
                        console.log('Adding to root: ' + root.toString() + " child: " + n.toString());
                    }
                }
            }
            else {
                // get parent node and add current node as a child
                if(item.dir) {
                    var parent = parts.splice(0, parts.length - 2).join("/") + "/";
                }
                else {
                    var parent = parts.splice(0, parts.length - 1).join("/") + "/";
                }
                var parentNode = this.jarMap.get(parent);
                if(parentNode) {
                    parentNode.children.push(n);
                    if(debug) {
                        console.log('Adding to parent: ' + parentNode.toString() + " child: " + n.toString());
                    }

                    // if class file, mark parent node as Java package
                    if(n.isClassFile && !parentNode.isPackage) {
                        parentNode.setPackage(true);
                        this.packages.push(parentNode);
                    }
                }
            }
        });

        this.packages.sort((a: GraphNode, b: GraphNode) => {
            return a.filePath.localeCompare(b.filePath);
        });
    }

    private clearMap(): void {
        this.jarMap.clear();
        this.packages = [];
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
        console.log(`parseJarFile: ${this.jarFilePath}  ${this.jarFileName}`);

        // Parse jar file
        try {
            // Read the content of the JAR file
            const jarData = await vscode.workspace.fs.readFile(this.uri!);

            // Load the JAR file data with JSZip5
            this.jarFile = (await JSZip.loadAsync(jarData)) as unknown as JSZip;

            if(debug) {
                console.log(`Jar file contents: >>>>>>>>`);
                this.jarFile?.forEach((relativePath, zipEntry) => {
                    console.log(`relativePath: ` + relativePath + `, zipEntry: ` + zipEntry.name + `, dir: ` + zipEntry.dir);
                });
                console.log(`Jar file contents: <<<<<<<<`);
            }

            var fileList = new Map<string, FileEntry>();
            this.jarFile?.forEach((relativePath, zipEntry) => {
                var n = new FileEntry(zipEntry.name, zipEntry.dir);
                fileList.set(zipEntry.name, n);
            });

            this.createMap(fileList);

            var rootNode = this.jarMap.get(this.jarFilePath);
            // if no children, add all folders from jarFiles
            if (rootNode && rootNode.children.length == 0) {
                console.log('No children found in root node! Refactoring...');
                this.clearMap();

                // get all folders from jarFiles and add to subFolders
                var newFileList = new Map<string, FileEntry>();
                this.jarFile?.forEach((relativePath, zipEntry) => {
                    // console.log(`relativePath: ` + relativePath + `, zipEntry: ` + zipEntry.name);
                    if (!zipEntry.name.endsWith("/")) {
                        // Convert com/denso/directorlib/utils/Utils.class to the following list:
                        //      com/denso/directorlib/utils/
                        //      com/denso/directorlib/
                        //      com/denso/
                        //      com/
                        var length = zipEntry.name.split("/").length;
                        if (length > 1) {
                            var index = 1;
                            while (index < length) {
                                var parts = zipEntry.name.split("/");
                                var path = parts.splice(0, index).join("/") + "/";
                                var n = new FileEntry(path, true);
                                if (!newFileList.has(path) && !fileList.has(path)) {
                                    newFileList.set(path, n);
                                }
                                index++;
                            }
                        }
                    }
                });
                if(debug) {
                    newFileList?.forEach((item: FileEntry, key: string) => {
                        console.log('New file list -> name: ' + item.name + ` dir: ${item.dir}`);
                    })
                }
                this.jarFile?.forEach((relativePath, zipEntry) => {
                    var n = new FileEntry(zipEntry.name, zipEntry.dir);
                    newFileList.set(zipEntry.name, n);
                });
                if(debug) {
                    newFileList?.forEach((item: FileEntry, key: string) => {
                        console.log('Final file list -> name: ' + item.name + ` dir: ${item.dir}`);
                    })
                }

                this.createMap(newFileList);
            }

            if(debug) {
                console.log('JarMap: ------start');
                this.jarMap.forEach((val: GraphNode, key: string) => {
                    console.log(`Key: ${key} Value: ` + val.toString());
                });
                console.log('JarMap: ------end');
            }

        } catch (error) {
            console.error(`Failed to parse JAR file: ${error}`);
            vscode.window.showErrorMessage(`Failed to parse JAR file: ${error}`);
        }
    }
}

class FileEntry {
    public name: string;
    public dir: boolean;

    constructor(name: string, dir: boolean) {
        this.name = name;
        this.dir = dir;
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
            console.log("New GraphNode value: " + this.toString());
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

    toString(): string {
        return "[[[name: " + this.fileName + " path: " + this.filePath + " isDir: " + this.isDir + " isClassFile: " + this.isClassFile + " isPackage: " + this.isPackage + " Children: " + this.children.length + "]]]";
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
