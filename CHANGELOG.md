# Change Log

## [1.6.0] - 2025-09-07

### Added
- New extension setting "javaPath" to specify path to java executable file

## [1.5.0] - 2025-08-04

### Added
- Search and filter for Java class files in JAR

## [1.4.0] - 2025-06-28

### Added
- Support for .zip, .war, and .ear files 

## [1.3.0] - 2025-05-31

### Added
- JAR files in open vscode editors can now be opened in extension by right clicking 
  on the editor title tab for .jar file 

## [1.2.2] - 2024-11-08

### Fixed
- Decompiling class files fail when there is a space in file path

## [1.2.1] - 2024-10-28

### Fixed
- Decompiling large .class files results in error: "stdout maxBuffer length exceeded"

### Added
- New extension setting "cfrOutputSize" to specify maximum CFR output buffer size
- New "Cancel" button to cancel long-running CFR decompilation processes

## [1.2.0] - 2024-09-08

### Added
- Search and filter for Java packages in JAR
- Collapse all button

## [1.1.0] - 2024-06-02

### Added
- Print internal type signatures for class files in JAR via right click

## [1.0.1] - 2024-05-28

### Fixed
- Nested directories in JAR did not correctly display 
- JAR file root name incorrectly included full path on Windows

## [1.0.0] - 2024-04-20

### Added
- Initial release of extension