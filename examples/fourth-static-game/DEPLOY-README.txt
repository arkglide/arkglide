ArkGlide 独立静态游戏
将整个目录放在 HTTP/HTTPS 静态服务器上，打开 index.html。支持子目录；不要直接双击 file://。
本地试运行：python -m http.server 8080
开始后在游戏内点击“启用音频”或点击画面解锁音频。停止后可重新开始。
所有项目脚本及预制体资源已包含；未登记的脚本 fetch/远程资源不自动打包。
数学与 Jolt WASM 内嵌在 lib/*.js，无外置 .wasm。
