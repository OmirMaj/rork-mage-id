require 'json'

# The version/author/licence fields come from ../package.json, the same way
# every first-party Expo module's podspec does (see
# node_modules/expo-haptics/ios/ExpoHaptics.podspec). That file exists ONLY to
# feed this podspec and expo-modules-autolinking — the module has no JS entry
# point and is never imported through Metro. See ../README.md.
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MageArTrack'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  # 15.1 is the SDK 54 / Expo default floor that ios/Podfile already pins.
  # Every ARKit API this module calls clears it: world tracking is iOS 11,
  # raycastQuery is 13, sceneDepth is 14. The one exception,
  # captureHighResolutionFrame, is iOS 16 and is guarded with @available.
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/mageid/mage-id.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # NO `s.frameworks = 'ARKit'`. Swift auto-links what `import ARKit` needs, and
  # the import is compiled OUT on the simulator slice (see ARTrackSession.swift's
  # `#if targetEnvironment(simulator)`), so the simulator build never references
  # a framework it may not carry.

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
