@echo off
cd /d "C:\Users\cleit\OneDrive\Documentos\app montadores"
start "App Montadores - API" cmd /k "npm run dev:api"
start "App Montadores - Web" cmd /k "npm run dev:web"
