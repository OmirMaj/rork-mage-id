require 'json'

# The version/author/licence fields come from ../package.json, the same way
# modules/mage-ar-track does. That file exists ONLY to feed this podspec and
# expo-modules-autolinking: the module has no JS entry point and is never
# imported through Metro. See ../README.md.
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MageRoomScan'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  # 15.1 is the floor ios/Podfile already pins, and it is NOT raised here.
  # RoomPlan is iOS 16. Every use of it is behind `#if canImport(RoomPlan)` and
  # `@available(iOS 16.0, *)`, and on iOS 15 the module answers "osTooOld".
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/mageid/mage-id.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # RoomPlan does not exist on iOS 15. With a 15.1 deployment target Swift
  # weak-links a framework whose every symbol is newer than the target, but
  # that has NOT been checked on an iOS 15 phone for this module, so the weak
  # link is stated outright. Without it an iOS 15 phone could fail at launch
  # (dyld: Library not loaded) before any JavaScript runs.
  # UNSURE: confirm on a real iOS 15 device or simulator (docs/scan-the-room-native-checklist.md).
  s.weak_frameworks = 'RoomPlan'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
