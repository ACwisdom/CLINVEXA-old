#ifndef SourceDir
  #error SourceDir must point to release\win-unpacked
#endif
#ifndef OutputDir
  #error OutputDir must point to the release directory
#endif
#ifndef AppVersion
  #define AppVersion "0.17.2"
#endif
#ifndef IconFile
  #error IconFile must point to assets\icon.ico
#endif
#ifndef CompressionMode
  #define CompressionMode "lzma2/normal"
#endif
#ifndef OutputName
  #define OutputName "CLINVEXA-" + AppVersion + "-win-x64"
#endif
#ifndef MinimumWindowsVersion
  #define MinimumWindowsVersion "10.0.19045"
#endif

[Setup]
AppId={{DD240AB1-7144-5589-8F42-81D466FA3506}
AppName=CLINVEXA
AppVersion={#AppVersion}
AppVerName=CLINVEXA {#AppVersion}
AppPublisher=CLINVEXA
AppPublisherURL=https://ai.keningcube.com
VersionInfoCompany=CLINVEXA
VersionInfoDescription=CLINVEXA 医疗 AI 办公助手安装程序
VersionInfoProductName=CLINVEXA
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}.0
DefaultDirName={localappdata}\Programs\CLINVEXA
; Never inherit a stale temporary or developer installation directory from
; an earlier build. CLINVEXA has exactly one supported per-user entrance.
UsePreviousAppDir=no
DefaultGroupName=CLINVEXA
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\CLINVEXA.exe
Compression={#CompressionMode}
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4
Uninstallable=not IsVerificationInstall
CreateUninstallRegKey=not IsVerificationInstall
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
CloseApplications=force
RestartApplications=no
MinVersion={#MinimumWindowsVersion}
SetupLogging=yes
DiskSpanning=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "\resources\clinvexa-dependencies\windows-x64.tar.gz,\resources\clinvexa-dependencies\PortableGit-2.54.0-64-bit.7z.exe"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\resources\clinvexa-dependencies\windows-x64.tar.gz"; DestDir: "{app}\resources\clinvexa-dependencies"; Flags: ignoreversion nocompression
Source: "{#SourceDir}\resources\clinvexa-dependencies\PortableGit-2.54.0-64-bit.7z.exe"; DestDir: "{app}\resources\clinvexa-dependencies"; Flags: ignoreversion nocompression

[Icons]
Name: "{autoprograms}\CLINVEXA"; Filename: "{app}\CLINVEXA.exe"; WorkingDir: "{app}"; Check: not IsVerificationInstall
Name: "{autodesktop}\CLINVEXA"; Filename: "{app}\CLINVEXA.exe"; WorkingDir: "{app}"; Tasks: desktopicon; Check: not IsVerificationInstall
Name: "{autoprograms}\CLINVEXA\安装与使用指南"; Filename: "{app}\resources\clinvexa-runtime\docs\CLINVEXA-用户安装与使用指南.md"; Check: not IsVerificationInstall
Name: "{autoprograms}\CLINVEXA\医疗功能介绍"; Filename: "{app}\resources\clinvexa-runtime\docs\CLINVEXA-医疗场景与功能介绍.md"; Check: not IsVerificationInstall
Name: "{autoprograms}\CLINVEXA\卸载 CLINVEXA"; Filename: "{uninstallexe}"; Check: not IsVerificationInstall

[Run]
Filename: "{app}\CLINVEXA.exe"; Description: "启动 CLINVEXA"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
// Exercise the final installer in an isolated directory without replacing the
// user's registered installation or shortcuts. Normal installs are unchanged.
function IsVerificationInstall: Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:VerifyOnly|0}') = '1');
end;
