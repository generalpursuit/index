#!/usr/bin/env python3
"""Reproduce the checked-in Xcode project without a project-generator dependency."""
from pathlib import Path
import argparse
import hashlib
import json

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=root / "Index.xcodeproj", help="Generated project directory")
project = parser.parse_args().output
(project / "xcshareddata/xcschemes").mkdir(parents=True, exist_ok=True)
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
    add('project-' + mode, '{ isa = XCBuildConfiguration; buildSettings = ' + settings({'SDKROOT': 'iphoneos', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SWIFT_VERSION': '6.0', 'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O', 'ONLY_ACTIVE_ARCH': 'YES' if mode == 'Debug' else 'NO', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG' if mode == 'Debug' else '', 'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym'}) + f'; name = {mode}; }}')
    add('app-' + mode, '{ isa = XCBuildConfiguration; baseConfigurationReference = ' + configs[mode] + '; buildSettings = ' + settings({'PRODUCT_NAME': 'Index', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.generalpursuit.index', 'INFOPLIST_FILE': 'Config/Info.plist', 'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGN_STYLE': 'Automatic', 'CODE_SIGN_ENTITLEMENTS': 'Config/Index.entitlements', 'TARGETED_DEVICE_FAMILY': '1,2', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO', 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES': 'AppIconPaper', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks'}) + f'; name = {mode}; }}')
for target, platform in [('share-ios', 'iOS'), ('share-mac', 'macOS')]:
    for mode in ['Debug', 'Release']:
        values = {'PRODUCT_NAME': 'IndexShare' if platform == 'iOS' else 'IndexShareMac', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.generalpursuit.index.share' if platform == 'iOS' else 'com.generalpursuit.index.share-mac', 'INFOPLIST_FILE': f'ShareExtension/{platform}-Info.plist', 'CODE_SIGN_ENTITLEMENTS': f'ShareExtension/{platform}.entitlements', 'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGN_STYLE': 'Automatic', 'APPLICATION_EXTENSION_API_ONLY': 'YES', 'SKIP_INSTALL': 'YES', 'SWIFT_VERSION': '6.0', 'MARKETING_VERSION': '1.0.0', 'CURRENT_PROJECT_VERSION': '1', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks' if platform == 'iOS' else '$(inherited) @executable_path/../Frameworks @executable_path/../../../../Frameworks'}
        if platform == 'iOS': values.update({'SDKROOT': 'iphoneos', 'TARGETED_DEVICE_FAMILY': '1,2', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0'})
        else:
            # Command-line provisioning overrides would also reach Swift package resource bundles.
            values.update({'SDKROOT': 'macosx', 'SUPPORTED_PLATFORMS': 'macosx', 'MACOSX_DEPLOYMENT_TARGET': '14.0', 'INDEX_SHARE_DISPLAY_NAME': 'Index', 'INDEX_SHARE_EXTENSION_ID': 'com.generalpursuit.index.share-mac', 'PRODUCT_BUNDLE_IDENTIFIER': '$(INDEX_SHARE_EXTENSION_ID)', 'INDEX_MAC_CODE_SIGN_STYLE': 'Automatic', 'CODE_SIGN_STYLE': '$(INDEX_MAC_CODE_SIGN_STYLE)', 'PROVISIONING_PROFILE_SPECIFIER': '$(INDEX_MAC_EXTENSION_PROFILE_SPECIFIER)'})
            values.update({'DEVELOPMENT_TEAM': '$(INDEX_APPLE_TEAM_ID)', 'INDEX_MAC_CODE_SIGN_IDENTITY': 'Apple Development', 'CODE_SIGN_IDENTITY': '$(INDEX_MAC_CODE_SIGN_IDENTITY)'})
            if mode == 'Release':
                values.update({'CODE_SIGN_INJECT_BASE_ENTITLEMENTS': 'NO', 'OTHER_CODE_SIGN_FLAGS': '$(inherited) --timestamp'})
        add(target+'-'+mode, '{ isa = XCBuildConfiguration; baseConfigurationReference = '+configs[mode]+'; buildSettings = '+settings(values)+f'; name = {mode}; }}')
for kind in ['project', 'app', 'share-ios', 'share-mac']:
    add(kind + '-config-list', '{ isa = XCConfigurationList; buildConfigurations = (' + ','.join(ref(kind+'-'+m) for m in ['Debug','Release']) + ',); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }')
add('local-package', '{ isa = XCLocalSwiftPackageReference; relativePath = .; }')
add('core-product', '{ isa = XCSwiftPackageProductDependency; productName = IndexCore; }')
add('core-build', '{ isa = PBXBuildFile; productRef = ' + ref('core-product') + '; }')
add('ui-product', '{ isa = XCSwiftPackageProductDependency; productName = IndexUI; }')
add('ui-build', '{ isa = PBXBuildFile; productRef = ' + ref('ui-product') + '; }')
add('features-product', '{ isa = XCSwiftPackageProductDependency; productName = IndexFeatures; }')
add('features-build', '{ isa = PBXBuildFile; productRef = ' + ref('features-product') + '; }')
add('frameworks', '{ isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (' + ref('core-build') + ',' + ref('ui-build') + ',' + ref('features-build') + ',); runOnlyForDeploymentPostprocessing = 0; }')
add('sources', '{ isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (' + ','.join(build_refs) + ',); runOnlyForDeploymentPostprocessing = 0; }')
assets = add('assets', '{ isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Resources/Assets.xcassets; sourceTree = SOURCE_ROOT; }')
add('assets-build', '{ isa = PBXBuildFile; fileRef = '+assets+'; }')
add('resources', '{ isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ('+ref('assets-build')+',); runOnlyForDeploymentPostprocessing = 0; }')
add('validate', '{ isa = PBXShellScriptBuildPhase; alwaysOutOfDate = 1; name = "Validate release endpoints"; buildActionMask = 2147483647; files = (); inputPaths = (); outputPaths = (); runOnlyForDeploymentPostprocessing = 0; shellPath = /bin/sh; shellScript = ' + quote('if [ "$CONFIGURATION" = "Release" ]; then\ncase "$INDEX_API_URL" in https://*) ;; *) echo "error: Set INDEX_API_URL to your HTTPS API in Config/Local.xcconfig"; exit 1;; esac\ncase "$INDEX_WEB_URL" in https://*) ;; *) echo "error: Set INDEX_WEB_URL to your HTTPS web app"; exit 1;; esac\nfi\n') + '; }')
# Real extension products, each with its own source/framework/configuration phases.
share_source = add('share-source', '{ isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ShareExtension/ShareViewController.swift; sourceTree = SOURCE_ROOT; }')
for target, name in [('share-ios', 'IndexShare'), ('share-mac', 'IndexShareMac')]:
    add(target+'-source-build', '{ isa = PBXBuildFile; fileRef = '+share_source+'; }')
    add(target+'-sources', '{ isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+ref(target+'-source-build')+',); runOnlyForDeploymentPostprocessing = 0; }')
    products = []
    builds = []
    for product_name in ['IndexCore', 'IndexSharing', 'IndexUI']:
        product_ref = add(target+'-'+product_name, '{ isa = XCSwiftPackageProductDependency; productName = '+product_name+'; }')
        products.append(product_ref)
        builds.append(add(target+'-'+product_name+'-build', '{ isa = PBXBuildFile; productRef = '+product_ref+'; }'))
    add(target+'-frameworks', '{ isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ('+','.join(builds)+',); runOnlyForDeploymentPostprocessing = 0; }')
    add(target+'-product', '{ isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; path = '+name+'.appex; sourceTree = BUILT_PRODUCTS_DIR; }')
    add(target, '{ isa = PBXNativeTarget; buildConfigurationList = '+ref(target+'-config-list')+'; buildPhases = ('+ref(target+'-sources')+','+ref(target+'-frameworks')+',); buildRules = (); dependencies = (); name = '+name+'; packageProductDependencies = ('+','.join(products)+',); productName = '+name+'; productReference = '+ref(target+'-product')+'; productType = "com.apple.product-type.app-extension"; }')
add('share-proxy', '{ isa = PBXContainerItemProxy; containerPortal = '+ref('project')+'; proxyType = 1; remoteGlobalIDString = '+ref('share-ios')+'; remoteInfo = IndexShare; }')
add('share-dependency', '{ isa = PBXTargetDependency; target = '+ref('share-ios')+'; targetProxy = '+ref('share-proxy')+'; }')
add('share-embed-build', '{ isa = PBXBuildFile; fileRef = '+ref('share-ios-product')+'; settings = { ATTRIBUTES = (RemoveHeadersOnCopy,); }; }')
add('share-embed', '{ isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = ('+ref('share-embed-build')+',); name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0; }')
product = add('product', '{ isa = PBXFileReference; explicitFileType = wrapper.application; path = Index.app; sourceTree = BUILT_PRODUCTS_DIR; }')
add('products', '{ isa = PBXGroup; children = (' + product + ',' + ref('share-ios-product') + ',' + ref('share-mac-product') + ',); name = Products; sourceTree = "<group>"; }')
add('main-group', '{ isa = PBXGroup; children = (' + ','.join(source_refs + list(configs.values()) + [assets, share_source, ref('products')]) + ',); sourceTree = "<group>"; }')
add('app', '{ isa = PBXNativeTarget; buildConfigurationList = ' + ref('app-config-list') + '; buildPhases = (' + ','.join(ref(x) for x in ['validate','sources','frameworks','resources','share-embed']) + ',); buildRules = (); dependencies = (' + ref('share-dependency') + ',); name = Index; packageProductDependencies = (' + ref('core-product') + ',' + ref('ui-product') + ',' + ref('features-product') + ',); productName = Index; productReference = ' + product + '; productType = "com.apple.product-type.application"; }')
add('project', '{ isa = PBXProject; attributes = { LastUpgradeCheck = 1600; }; buildConfigurationList = ' + ref('project-config-list') + '; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base,); mainGroup = ' + ref('main-group') + '; packageReferences = (' + ref('local-package') + ',); productRefGroup = ' + ref('products') + '; projectDirPath = ""; projectRoot = ""; targets = (' + ref('app') + ',' + ref('share-ios') + ',' + ref('share-mac') + ',); }')
content = '// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(f'{key} = {value};' for key,value in objects.items()) + '\n}; rootObject = ' + ref('project') + '; }\n'
(project / 'project.pbxproj').write_text(content)
(project / 'xcshareddata/xcschemes/Index.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref('app')}" BuildableName="Index.app" BlueprintName="Index" ReferencedContainer="container:Index.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"/>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref('app')}" BuildableName="Index.app" BlueprintName="Index" ReferencedContainer="container:Index.xcodeproj"/></BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')

for target, name in [('share-ios', 'IndexShare'), ('share-mac', 'IndexShareMac')]:
    (project / f'xcshareddata/xcschemes/{name}.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref(target)}" BuildableName="{name}.appex" BlueprintName="{name}" ReferencedContainer="container:Index.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
