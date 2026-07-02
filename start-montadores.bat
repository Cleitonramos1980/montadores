@echo off
REM Aguarda 15 segundos para o sistema carregar completamente
timeout /t 15 /nobreak >nul

REM Inicia o daemon PM2 e restaura os processos salvos
call "C:\Users\cleit\AppData\Roaming\npm\pm2.cmd" resurrect

REM Aguarda 5 segundos para confirmar que os processos subiram
timeout /t 5 /nobreak >nul

REM Salva o estado atual para garantir persistência
call "C:\Users\cleit\AppData\Roaming\npm\pm2.cmd" save
