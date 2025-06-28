# jar-viewer-and-decompiler

## Features

This extension allows you to browse the contents of Java JAR and other archive files within Visual Studio Code. To launch this extension, right click on a .jar, .zip, .war, or .ear file in the VSCode explorer or editor and select "Open With JAR Viewer and Decompiler".

Java class files in the JARs can be decompiled. Decompiling class files requires CFR to be available. Do NOT use this extension to decompile class files which you do not have legal rights to do so.

![Extension preview](https://raw.githubusercontent.com/recursean/JAR-Viewer-and-Decompiler-VSCode-Extension/main/media/preview.gif)

Additional Features
- Search for Java packages within JAR using regular expressions
- Display internal type signatures via right click on .class files within JAR
- Supports file formats: .jar, .zip, .war, .ear

## Requirements
- VSCode version 1.88.0 or newer.
- To view the decompiled contents of Java class files within JARs, the CFR decompiler JAR file needs to be downloaded and the path provided to the `cfrPath` setting. CFR can be downloaded [here](https://www.benf.org/other/cfr/).
- To view the decompiled contents of Java class files and print type signatures, Java must be on your PATH.

## Extension Settings
This extension contributes the following settings:

* `jar-viewer-and-decompiler.cfrPath`: Path to the CFR decompiler JAR file. This is required for decompiling class files.
* `jar-viewer-and-decompiler.cfrOutputSize`: CFR decompiler maximum output buffer size. Specified in kilobytes (KB). Default: 250

## Known Issues

* JAR files within JAR files can not be viewed.