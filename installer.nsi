; ===================================================================
;  本地 AI 助手 · LocalAI Studio v3.0（现代 Web 界面版）—— NSIS 安装包脚本
;  编译： makensis.exe installer.nsi
;  产物： dist\本地AI助手_安装程序.exe
;
;  设计要点：
;    * RequestExecutionLevel user —— 装到 %LOCALAPPDATA%，不需要管理员权限
;    * Unicode true —— 支持中文界面与中文路径
;    * 安装时就让用户选「模型存放目录」，并写进 bootstrap.ini，
;      程序启动自动读取 —— 用户不需要改任何环境变量或配置文件
;    * 自动写注册表，出现在「设置 → 应用」里，带标准卸载程序
;    * 安装时检测后端是否就绪，缺了就明确告知用户
; ===================================================================

Unicode true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

!define APP_NAME    "本地 AI 助手"
!define APP_EXE     "本地AI助手.exe"
!define APP_VER     "3.0"
!define APP_PUB     "本地离线部署"
!define REG_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\LocalAIStudio"
; 打包产物所在目录。本地构建时指向部署目录；CI 里用
;   makensis /DSRC_DIR=dist installer.nsi
; 覆盖成相对路径即可。
!ifndef SRC_DIR
  !define SRC_DIR "E:\depseekbushu\dist"
!endif
!ifndef DEPLOY_ROOT
  !define DEPLOY_ROOT "E:\depseekbushu"
!endif

Name "${APP_NAME}"
OutFile "${SRC_DIR}\本地AI助手_安装程序.exe"
InstallDir "$LOCALAPPDATA\本地AI助手"
InstallDirRegKey HKCU "${REG_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

Var ModelsDir
Var ModelsDirCtrl
Var SpaceLabel

; --------------------------------------------------------- 默认模型目录
; 优先放 D 盘；没有 D 盘就放到本地应用数据目录
; 静默安装时可用 /MODELSDIR=<路径> 指定
Function .onInit
  StrCpy $ModelsDir "$LOCALAPPDATA\本地AI助手\models"
  IfFileExists "D:\*.*" 0 +2
    StrCpy $ModelsDir "D:\LocalAI\models"

  ${GetOptions} $CMDLINE "/MODELSDIR=" $R0
  ${IfNot} ${Errors}
    StrCmp $R0 "" +2 0
      StrCpy $ModelsDir $R0
  ${EndIf}
FunctionEnd

; --------------------------------------------------------- 界面
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ModelsPageCreate ModelsPageLeave

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\使用说明.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

; --------------------------------------------------------- 模型目录页
Function ModelsUpdateSpace
  ${NSD_GetText} $ModelsDirCtrl $ModelsDir
  ${GetRoot} "$ModelsDir" $R0
  StrCpy $R1 "无法读取"
  ${If} $R0 != ""
    ${DriveSpace} "$R0\" "/D=F /S=M" $R1
  ${EndIf}
  ${NSD_SetText} $SpaceLabel "所选磁盘（$R0）当前可用空间：$R1 MB        单个模型约需 300 MB – 9 GB"
FunctionEnd

Function ModelsPageCreate
  !insertmacro MUI_HEADER_TEXT "选择模型存放位置" "程序本身只有约 12 MB，模型权重才是占空间的部分。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u \
    "程序本身约 12 MB。模型不会随安装包一起装，而是在你使用「模型市场」时按需下载到这里。$\r$\n$\r$\n请选一个空间充足的磁盘（建议预留 20 GB 以上）。以后想改，在程序的「设置」里改即可，不用重装。"
  Pop $0

  ${NSD_CreateLabel} 0 44u 100% 12u "模型存放目录："
  Pop $0

  ${NSD_CreateDirRequest} 0 58u 76% 13u "$ModelsDir"
  Pop $ModelsDirCtrl

  ${NSD_CreateBrowseButton} 78% 58u 22% 13u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 ModelsBrowse

  ${NSD_CreateLabel} 0 80u 100% 24u ""
  Pop $SpaceLabel
  Call ModelsUpdateSpace

  nsDialogs::Show
FunctionEnd

Function ModelsBrowse
  ${NSD_GetText} $ModelsDirCtrl $ModelsDir
  nsdialogs::SelectFolderDialog "选择模型存放目录" "$ModelsDir"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $ModelsDirCtrl "$0"
    Call ModelsUpdateSpace
  ${EndIf}
FunctionEnd

Function ModelsPageLeave
  ${NSD_GetText} $ModelsDirCtrl $ModelsDir
FunctionEnd

; --------------------------------------------------------- 安装
Section "主程序（必需）" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  File "${SRC_DIR}\${APP_EXE}"
  File "${SRC_DIR}\使用说明.txt"

  ; 模型目录通过注册表传给程序（见下面的 WriteRegStr）。
  ; 不写 bootstrap.ini —— 实测 NSIS 的 FileOpen/FileWrite 在此环境下
  ; 只会建出 0 字节空文件，留着反而让人以为配置写进去了。
  ; （便携版用户仍可手动放一个 bootstrap.ini，程序同样会读。）

  ${If} $ModelsDir != ""
    CreateDirectory "$ModelsDir"
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\卸载.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteUninstaller "$INSTDIR\卸载.exe"

  WriteRegStr HKCU "${REG_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "${REG_KEY}" "DisplayVersion"  "${APP_VER}"
  WriteRegStr HKCU "${REG_KEY}" "Publisher"       "${APP_PUB}"
  WriteRegStr HKCU "${REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG_KEY}" "UninstallString" '"$INSTDIR\卸载.exe"'
  WriteRegStr HKCU "${REG_KEY}" "QuietUninstallString" '"$INSTDIR\卸载.exe" /S'
  WriteRegDWORD HKCU "${REG_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REG_KEY}" "NoRepair" 1

  ; 安装时选的模型目录主要靠注册表传给程序。
  ; 实测 NSIS 的 FileOpen/FileWrite 在此环境下会建出 0 字节空文件，
  ; 而 WriteRegStr 稳定可靠，所以以注册表为准（bootstrap.ini 仅作备用）。
  WriteRegStr HKCU "Software\LocalAIStudio" "modelsDir"  "$ModelsDir"
  WriteRegStr HKCU "Software\LocalAIStudio" "installDir" "$INSTDIR"
  WriteRegStr HKCU "Software\LocalAIStudio" "host"       "127.0.0.1:11434"
  WriteRegStr HKCU "Software\LocalAIStudio" "keepAlive"  "30m"
  WriteRegStr HKCU "Software\LocalAIStudio" "version"    "${APP_VER}"
SectionEnd

; --------------------------------------------------------- 后端检测
Section "后端环境检测" SecCheck
  SectionIn RO
  DetailPrint "正在检测本机 Ollama 后端…"
  DetailPrint "模型目录已设置为：$ModelsDir"

  IfFileExists "${DEPLOY_ROOT}\ollama\ollama.exe" backend_ok
  IfFileExists "$LOCALAPPDATA\本地AI助手\ollama\ollama.exe" backend_ok
  IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" backend_ok
  IfFileExists "$PROGRAMFILES\Ollama\ollama.exe" backend_ok

  ; 静默安装时不弹窗，只写详情
  IfSilent backend_missing_silent

  MessageBox MB_ICONINFORMATION|MB_OK \
    "程序已安装完成，但本机还没有 Ollama 后端。$\r$\n$\r$\n\
     说明：本程序是「客户端」，负责界面、模型市场与下载管理；$\r$\n\
     真正的模型计算由 Ollama 完成，需要单独安装一次。$\r$\n$\r$\n\
     下一步：$\r$\n\
     1. 到 ollama.com 下载 Windows 版并安装（约 1.8 GB）$\r$\n\
     2. 重新打开「本地 AI 助手」即可正常使用$\r$\n$\r$\n\
     模型存放目录已为你设好：$ModelsDir$\r$\n\
     不需要设置任何环境变量。"
  Goto done

  backend_missing_silent:
  DetailPrint "未检测到 Ollama 后端：请到 ollama.com 安装后再使用。模型目录：$ModelsDir"
  Goto done

  backend_ok:
  DetailPrint "已检测到 Ollama 后端，安装后即可直接使用。"

  done:
SectionEnd

; --------------------------------------------------------- 卸载
Section "Uninstall"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\使用说明.txt"
  Delete "$INSTDIR\bootstrap.ini"
  Delete "$INSTDIR\卸载.exe"

  ; 浏览器配置目录一定要删（是缓存，没用户价值，留着会让安装目录删不掉）
  RMDir /r "$INSTDIR\webprofile"
  RMDir /r "$INSTDIR\chats\webprofile"

  ; 判断条件不能用 *.json：程序首次运行并不会写 web-settings.json，
  ; 会被误判成"没有用户数据"而跳过清理，导致安装目录删不掉。
  IfFileExists "$INSTDIR\chats\*.*" 0 no_chats
  IfSilent del_chats
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除聊天记录、知识库与设置？$\r$\n（选择「否」将保留在 $INSTDIR\chats）" \
    IDYES del_chats IDNO no_chats
  del_chats:
    ; 必须用 /r：chats 里还有 localai.log、kb\ 等，非空目录 RMDir 会失败
    RMDir /r "$INSTDIR\chats"
  no_chats:

  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  DeleteRegKey HKCU "${REG_KEY}"
  DeleteRegKey HKCU "Software\LocalAIStudio"

  ; 模型目录不删（体积大，且可能被别的程序共用）
  IfSilent un_done
  MessageBox MB_ICONINFORMATION|MB_OK \
    "卸载完成。$\r$\n$\r$\n模型文件仍保留在：$ModelsDir$\r$\n如需彻底清理请手动删除该目录。"
  un_done:
SectionEnd
