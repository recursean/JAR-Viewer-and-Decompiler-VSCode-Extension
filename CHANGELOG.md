# Change Log

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