#!/usr/bin/env python3
"""Reproduce the checked-in Xcode project without a project-generator dependency."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent.parent
objects = {}
def ident(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def add(name, value):
    key = ident(name)
    objects[key] = value
    return key
def ref(name): return ident(name)
def quote(value): return json.dumps(str(value))
def settings(values): return '{ ' + ' '.join(f'{key} = {quote(value)};' for key, value in values.items()) + ' }'

source_refs = []
build_refs = []
for file in sorted((root / 'Sources/IndexApp').rglob('*.swift')):
    path = file.relative_to(root).as_posix()
    f = add(path, f'{{ isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quote(path)}; sourceTree = SOURCE_ROOT; }}')
    source_refs.append(f)
    build_refs.append(add('build:' + path, f'{{ isa = PBXBuildFile; fileRef = {f}; }}'))
configs = {}
for mode in ['Debug', 'Release']:
    configs[mode] = add(mode + '.xcconfig', f'{{ isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config/{mode}.xcconfig; sourceTree = SOURCE_ROOT; }}')
    add('project-' + mode, '{ isa = XCBuildConfiguration; buildSettings = ' + settings({'SDKROOT': 'iphoneos', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SWIFT_VERSION': '6.0', 'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG' if mode == 'Debug' else '', 'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym'}) + f'; name = {mode}; }}')
    add('app-' + mode, '{ isa = XCBuildConfiguration; baseConfigurationReference = ' + configs[mode] + '; buildSettings = ' + settings({'PRODUCT_NAME': 'Index', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.generalpursuit.index', 'INFOPLIST_FILE': 'Config/Info.plist', 'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGN_STYLE': 'Automatic', 'CODE_SIGN_ENTITLEMENTS': 'Config/Notifications.entitlements', 'TARGETED_DEVICE_FAMILY': '1,2', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO', 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks'}) + f'; name = {mode}; }}')
for kind in ['project', 'app']:
    add(kind + '-config-list', '{ isa = XCConfigurationList; buildConfigurations = (' + ','.join(ref(kind+'-'+m) for m in ['Debug','Release']) + ',); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }')
add('local-package', '{ isa = XCLocalSwiftPackageReference; relativePath = .; }')
add('core-product', '{ isa = XCSwiftPackageProductDependency; productName = IndexCore; }')
add('core-build', '{ isa = PBXBuildFile; productRef = ' + ref('core-product') + '; }')
add('frameworks', '{ isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (' + ref('core-build') + ',); runOnlyForDeploymentPostprocessing = 0; }')
add('sources', '{ isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (' + ','.join(build_refs) + ',); runOnlyForDeploymentPostprocessing = 0; }')
assets = add('assets', '{ isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Resources/Assets.xcassets; sourceTree = SOURCE_ROOT; }')
add('assets-build', '{ isa = PBXBuildFile; fileRef = '+assets+'; }')
add('resources', '{ isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ('+ref('assets-build')+',); runOnlyForDeploymentPostprocessing = 0; }')
add('validate', '{ isa = PBXShellScriptBuildPhase; buildActionMask = 2147483647; files = (); inputPaths = (); outputPaths = (); runOnlyForDeploymentPostprocessing = 0; shellPath = /bin/sh; shellScript = ' + quote('if [ "$CONFIGURATION" = "Release" ]; then\ncase "$INDEX_API_URL" in https://*) ;; *) echo "error: Set INDEX_API_URL to your HTTPS API in Config/Local.xcconfig"; exit 1;; esac\ncase "$INDEX_WEB_URL" in https://*) ;; *) echo "error: Set INDEX_WEB_URL to your HTTPS web app"; exit 1;; esac\nfi\n') + '; }')
product = add('product', '{ isa = PBXFileReference; explicitFileType = wrapper.application; path = Index.app; sourceTree = BUILT_PRODUCTS_DIR; }')
add('products', '{ isa = PBXGroup; children = (' + product + ',); name = Products; sourceTree = "<group>"; }')
add('main-group', '{ isa = PBXGroup; children = (' + ','.join(source_refs + list(configs.values()) + [assets, ref('products')]) + ',); sourceTree = "<group>"; }')
add('app', '{ isa = PBXNativeTarget; buildConfigurationList = ' + ref('app-config-list') + '; buildPhases = (' + ','.join(ref(x) for x in ['validate','sources','frameworks','resources']) + ',); buildRules = (); dependencies = (); name = Index; packageProductDependencies = (' + ref('core-product') + ',); productName = Index; productReference = ' + product + '; productType = "com.apple.product-type.application"; }')
add('project', '{ isa = PBXProject; attributes = { LastUpgradeCheck = 1600; }; buildConfigurationList = ' + ref('project-config-list') + '; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base,); mainGroup = ' + ref('main-group') + '; packageReferences = (' + ref('local-package') + ',); productRefGroup = ' + ref('products') + '; projectDirPath = ""; projectRoot = ""; targets = (' + ref('app') + ',); }')
content = '// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(f'{key} = {value};' for key,value in objects.items()) + '\n}; rootObject = ' + ref('project') + '; }\n'
(root / 'Index.xcodeproj/project.pbxproj').write_text(content)
(root / 'Index.xcodeproj/xcshareddata/xcschemes/Index.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref('app')}" BuildableName="Index.app" BlueprintName="Index" ReferencedContainer="container:Index.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"/>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref('app')}" BuildableName="Index.app" BlueprintName="Index" ReferencedContainer="container:Index.xcodeproj"/></BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
