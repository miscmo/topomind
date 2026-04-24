@echo off
cd /d D:\Code\topomind_cc
call npx playwright test e2e-electron\room-nav.electron.spec.ts --grep "钻入子房间后显示知识库根与当前房间" --timeout 60000
