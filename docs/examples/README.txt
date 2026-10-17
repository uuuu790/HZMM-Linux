HZMM Config Standard 1.4 - examples
===================================

Each example shows one feature of the HZMM config schema. Full spec:
CONFIG_SCHEMA.md (next to this folder).

Every example is a pair of files with the same number:
  NN-name.hzmm.config.json   the UI schema
  NN-name.config.lua         the values HZMM edits

To try one, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
  NN-name.hzmm.config.json  as  <ModName>\hzmm.config.json
  NN-name.config.lua        as  <ModName>\Scripts\config.lua
plus a Scripts\main.lua, then open the mod's Config in HZMM. Each config.lua
starts with a short note on how main.lua reads its values.

  01-toggle               bool switch
  02-text                 text, with automatic escaping
  03-number               int / float, min and max
  04-slider               int and float sliders with step
  05-select               dropdown, pills, number options
  06-color                color picker
  07-keybind              hotkey capture (+ 07-keybind.main.lua: RegisterKeyBind)
  08-multi-select         pick several options
  09-list                 free-form string list
  10-show-when            show a row only when other keys match
  11-sections             section master switch (enableKey), collapsed section
  12-optional             keys the player can add or remove
  13-open-path            buttons that open a file or show it in its folder
  14-i18n                 labels in several languages, plain-string labels
  15-description-tokens   {value} and {eval: ...} in descriptions
  16-comment-mode         no schema: the editor built from config.lua comments
                          (this one goes in the mod root, see the file)
  17-all-in-one           every widget in one mod (+ 17-all-in-one.main.lua)


HZMM Config 標準 1.4 - 範例
===========================

每個範例示範 HZMM 設定 schema 的一項功能，完整規格見本資料夾旁的
CONFIG_SCHEMA.md。

每個範例是一組同編號的檔案：
  NN-名稱.hzmm.config.json   介面 schema
  NN-名稱.config.lua         HZMM 會修改的設定值

試用方式：建立一個 UE4SS 模組資料夾（ue4ss\Mods\<模組名稱>\），然後：
  NN-名稱.hzmm.config.json  另存為  <模組名稱>\hzmm.config.json
  NN-名稱.config.lua        另存為  <模組名稱>\Scripts\config.lua
再放一個 Scripts\main.lua，到 HZMM 打開該模組的設定即可。每個 config.lua
開頭都有註解說明 main.lua 怎麼讀取這些值。

  01-toggle               開關（bool）
  02-text                 文字，自動跳脫特殊字元
  03-number               整數／小數、min 與 max
  04-slider               整數與小數滑桿、step
  05-select               下拉選單、按鈕、數字選項
  06-color                調色盤
  07-keybind              快速鍵錄製（另附 07-keybind.main.lua：RegisterKeyBind 用法）
  08-multi-select         多選
  09-list                 自由輸入的字串清單
  10-show-when            依其他設定值決定是否顯示
  11-sections             區段總開關（enableKey）、預設收合的區段
  12-optional             玩家可自行加入或移除的設定
  13-open-path            開啟檔案或在資料夾中顯示的按鈕
  14-i18n                 多語言標題、單一字串標題
  15-description-tokens   說明文字中的 {value} 與 {eval: ...}
  16-comment-mode         不寫 schema，直接用 config.lua 的註解產生編輯器
                          （這個要放在模組根目錄，詳見檔案內說明）
  17-all-in-one           所有元件集中在一個模組（另附 17-all-in-one.main.lua）
