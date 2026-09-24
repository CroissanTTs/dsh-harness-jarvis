// swift-tools-version: 6.0
import PackageDescription

// 贾维斯悬浮窗 — native AppKit/SwiftUI/Metal panel.
// JarvisPanelCore holds all AppKit-free logic (models, view model, particle
// simulation, layout, visibility rules) so it can be unit-tested; JarvisPanel
// is the executable (windows, rendering, system observers, views).
let package = Package(
  name: "JarvisPanel",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "jarvis-panel", targets: ["JarvisPanel"]),
  ],
  targets: [
    .target(
      name: "JarvisPanelCore",
      path: "Sources/JarvisPanelCore",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .executableTarget(
      name: "JarvisPanel",
      dependencies: ["JarvisPanelCore"],
      path: "Sources/JarvisPanel",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "JarvisPanelCoreTests",
      dependencies: ["JarvisPanelCore"],
      path: "Tests/JarvisPanelCoreTests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "JarvisPanelHotKeyTests",
      dependencies: ["JarvisPanel", "JarvisPanelCore"],
      path: "Tests/JarvisPanelHotKeyTests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
