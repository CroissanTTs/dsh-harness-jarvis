// swift-tools-version: 6.0
import PackageDescription

// 贾维斯悬浮窗 — native SwiftUI/AppKit NSPanel (mirrors dsh-notch/macos).
// Reads ~/.dsh/jarvis/runtime.json (origin+token) and polls the host plugin's
// /jarvis/* routes. Built as an executable; launched standalone for MVP (host
// auto-spawn is a follow-up).
let package = Package(
  name: "JarvisPanel",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "jarvis-panel", targets: ["JarvisPanel"]),
  ],
  targets: [
    .executableTarget(name: "JarvisPanel", path: "Sources"),
  ]
)
