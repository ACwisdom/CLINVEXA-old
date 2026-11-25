#ifndef SourceDir
  #error SourceDir must contain the offline upgrade payload
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef BaseHash
  #error BaseHash is required
#endif
#ifndef TargetHash
  #error TargetHash is required
#endif
#ifndef OutputName
  #define OutputName "CLINVEXA-" + AppVersion + "-offline-upgrade-x64"
#endif
#ifndef MinimumWindowsVersion
  #define MinimumWindowsVersion "10.0.19045"
#endif

[Setup]
AppId={{DD240AB1-7144-5589-8F42-81D466FA3506}
AppName=CLINVEXA
AppVersion={#AppVersion}
AppPublisher=CLINVEXA
DefaultDirName={localappdata}\Programs\CLINVEXA
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
Compression=lzma2/fast
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion={#MinimumWindowsVersion}
CloseApplications=force
RestartApplications=no
Uninstallable=not IsVerificationInstall
CreateUninstallRegKey=not IsVerificationInstall
SetupLogging=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\CLINVEXA"; Filename: "{app}\CLINVEXA.exe"; WorkingDir: "{app}"; Check: not IsVerificationInstall

[Run]
Filename: "{app}\CLINVEXA.exe"; Description: "启动 CLINVEXA"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
function IsVerificationInstall: Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:VerifyOnly|0}') = '1');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  AppDir: String;
  ArchivePath: String;
  ArchiveHash: String;
begin
  Result := '';
  AppDir := ExpandConstant('{app}');
  ArchivePath := AppDir + '\resources\app.asar';
  if not FileExists(AppDir + '\CLINVEXA.exe') or not FileExists(ArchivePath) then
  begin
    Result := '请先在本用户目录安装 CLINVEXA 2.0.10。';
    Exit;
  end;
  ArchiveHash := GetSHA256OfFile(ArchivePath);
  if (CompareText(ArchiveHash, '{#BaseHash}') <> 0) and (CompareText(ArchiveHash, '{#TargetHash}') <> 0) then
    Result := '现有安装与支持的基线不匹配，请使用完整离线安装包。';
end;
