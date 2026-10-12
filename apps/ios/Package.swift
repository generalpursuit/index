// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Index",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "IndexCore", targets: ["IndexCore"]),
        .library(name: "IndexFeatures", targets: ["IndexFeatures"]),
        .library(name: "IndexSharing", targets: ["IndexSharing"]),
        .library(name: "IndexUI", targets: ["IndexUI"]),
        .executable(name: "IndexPreview", targets: ["IndexApp"])
    ],
    targets: [
        .target(name: "IndexCore"),
        .target(name: "IndexFeatures", dependencies: ["IndexCore"]),
        .target(name: "IndexUI", dependencies: ["IndexCore"], resources: [.process("Resources")]),
        .target(name: "IndexSharing", dependencies: ["IndexCore", "IndexUI"]),
        .executableTarget(name: "IndexApp", dependencies: ["IndexCore", "IndexUI", "IndexFeatures"]),
        .testTarget(name: "IndexFeaturesTests", dependencies: ["IndexCore", "IndexFeatures"]),
        .testTarget(name: "IndexCoreTests", dependencies: ["IndexCore"], resources: [.copy("Fixtures")])
    ]
)
