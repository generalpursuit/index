// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Index",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "IndexCore", targets: ["IndexCore"]), .executable(name: "IndexPreview", targets: ["IndexApp"])],
    targets: [
        .target(name: "IndexCore"),
        .executableTarget(name: "IndexApp", dependencies: ["IndexCore"]),
        .testTarget(name: "IndexCoreTests", dependencies: ["IndexCore"])
    ]
)
