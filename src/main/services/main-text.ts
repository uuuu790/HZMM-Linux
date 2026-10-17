// Text the main process shows itself: the tray menu and native file dialogs.
// Everything the renderer shows lives in src/renderer/src/constants/i18n;
// these few strings are needed before (or without) a window, so they stay
// here, keyed by the same locale codes.

export interface MainText {
  trayShow: string
  trayQuit: string
  modFiles: string
  allFiles: string
  ue4ssZipTitle: string
  ue4ssZipFilter: string
}

const TEXT: Record<string, MainText> = {
  'zh-TW': {
    trayShow: '顯示 HZMM',
    trayQuit: '結束',
    modFiles: '模組檔案',
    allFiles: '所有檔案',
    ue4ssZipTitle: '選擇 UE4SS 壓縮檔',
    ue4ssZipFilter: 'UE4SS 壓縮檔 (*.zip)'
  },
  en: {
    trayShow: 'Show HZMM',
    trayQuit: 'Quit',
    modFiles: 'Mod Files',
    allFiles: 'All Files',
    ue4ssZipTitle: 'Select UE4SS zip',
    ue4ssZipFilter: 'UE4SS archive (*.zip)'
  },
  ja: {
    trayShow: 'HZMM を表示',
    trayQuit: '終了',
    modFiles: 'MODファイル',
    allFiles: 'すべてのファイル',
    ue4ssZipTitle: 'UE4SS の zip を選択',
    ue4ssZipFilter: 'UE4SS アーカイブ (*.zip)'
  },
  ko: {
    trayShow: 'HZMM 열기',
    trayQuit: '종료',
    modFiles: '모드 파일',
    allFiles: '모든 파일',
    ue4ssZipTitle: 'UE4SS zip 선택',
    ue4ssZipFilter: 'UE4SS 압축 파일 (*.zip)'
  },
  ru: {
    trayShow: 'Показать HZMM',
    trayQuit: 'Выход',
    modFiles: 'Файлы модов',
    allFiles: 'Все файлы',
    ue4ssZipTitle: 'Выберите zip-архив UE4SS',
    ue4ssZipFilter: 'Архив UE4SS (*.zip)'
  },
  de: {
    trayShow: 'HZMM anzeigen',
    trayQuit: 'Beenden',
    modFiles: 'Mod-Dateien',
    allFiles: 'Alle Dateien',
    ue4ssZipTitle: 'UE4SS-ZIP auswählen',
    ue4ssZipFilter: 'UE4SS-Archiv (*.zip)'
  },
  fr: {
    trayShow: 'Afficher HZMM',
    trayQuit: 'Quitter',
    modFiles: 'Fichiers de mod',
    allFiles: 'Tous les fichiers',
    ue4ssZipTitle: "Choisir le zip d'UE4SS",
    ue4ssZipFilter: 'Archive UE4SS (*.zip)'
  }
}

export function mainText(locale: string): MainText {
  return TEXT[locale] ?? TEXT.en
}
