@echo off
REM Start the ShoeAR recommender service. Double-click this file, or run
REM `.\run.bat` from the ml-service folder. (First-time setup only: create the
REM venv with `py -3.12 -m venv venv` and `pip install -r requirements.txt`.)
cd /d "%~dp0"
if not exist "venv\Scripts\activate.bat" (
  echo [run] No venv found. First-time setup:
  echo        py -3.12 -m venv venv
  echo        venv\Scripts\activate
  echo        pip install -r requirements.txt
  pause
  exit /b 1
)
call venv\Scripts\activate.bat
python app.py
