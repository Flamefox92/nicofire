# ============================================================
#  NICOFIRE — One-Time Build Script
#  Produces a distributable Windows installer (.msi + .exe)
#
#  Run once on a build machine. The resulting installer can
#  then be given to any Windows PC for one-click installation
#  with NO tools required on the target machine.
#
#  Usage (right-click → Run with PowerShell, OR):
#    powershell -ExecutionPolicy Bypass -File BUILD.ps1
# ============================================================

$ErrorActionPreference = "Stop"

function Say($msg, $color="Cyan") { Write-Host "  $msg" -ForegroundColor $color }
function Ok($msg)  { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg){ Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "  [XX] $msg" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }

Write-Host ""
Write-Host "  =====================================================" -ForegroundColor Magenta
Write-Host "   NICOFIRE  -  Build Installer" -ForegroundColor Magenta
Write-Host "  =====================================================" -ForegroundColor Magenta
Write-Host ""

# --- Helper: refresh PATH in current session -------------------------------
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# --- Helper: is a command available? ---------------------------------------
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# --- 1. winget check --------------------------------------------------------
Say "Checking prerequisites..."
if (-not (Have "winget")) {
    Die "winget not found. Install 'App Installer' from the Microsoft Store, then re-run this script."
}
Ok "winget present"

# --- 2. Node.js -------------------------------------------------------------
Refresh-Path
if (-not (Have "node")) {
    Say "Installing Node.js LTS..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    Refresh-Path
} else { Ok "Node.js present ($(node --version))" }

# --- 3. Rust ----------------------------------------------------------------
Refresh-Path
if (-not (Have "cargo")) {
    Say "Installing Rust..."
    winget install Rustlang.Rustup --accept-package-agreements --accept-source-agreements --silent
    Refresh-Path
    # rustup lives in ~/.cargo/bin which may not be on PATH yet this session
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
    if (Have "rustup") { rustup default stable | Out-Null }
} else { Ok "Rust present ($(cargo --version))" }

# --- 4. Visual C++ Build Tools (the linker) ---------------------------------
# This is the step that trips everyone up. We detect link.exe via vswhere.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$needCpp = $true
if (Test-Path $vswhere) {
    $inst = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    if ($inst) { $needCpp = $false; Ok "C++ Build Tools present" }
}

if ($needCpp) {
    Say "Installing Visual C++ Build Tools (this is the big one, 5-15 min)..."
    # Install Build Tools shell if missing
    winget install Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --silent 2>$null

    $setup = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
    $btPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools"
    if (Test-Path $setup) {
        Say "Adding the C++ workload (Desktop development with C++)..."
        # Kill any running installer instance first (avoids singleton-lock error)
        Get-Process -Name "setup","vs_installer","vs_installershell" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $args = @("modify","--installPath",$btPath,
                  "--add","Microsoft.VisualStudio.Workload.VCTools",
                  "--includeRecommended","--quiet","--norestart","--wait")
        $p = Start-Process -FilePath $setup -ArgumentList $args -Wait -PassThru
        if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
            Warn "Automated C++ install returned code $($p.ExitCode)."
            Warn "Opening the Visual Studio Installer so you can add it manually:"
            Warn "  -> Tick 'Desktop development with C++' -> Modify"
            Start-Process -FilePath $setup
            Read-Host "Press Enter here AFTER the C++ workload has finished installing"
        } else {
            Ok "C++ Build Tools installed"
        }
    } else {
        Die "Could not locate the Visual Studio Installer. Install 'Desktop development with C++' manually from visualstudio.microsoft.com/downloads (Build Tools)."
    }
}

# --- 5. Tauri CLI (npm deps) ------------------------------------------------
Refresh-Path
Say "Installing project dependencies (Tauri CLI)..."
Push-Location $PSScriptRoot
try {
    & npm install
    if ($LASTEXITCODE -ne 0) { Die "npm install failed." }
    Ok "Dependencies installed"

    # --- 6. Build the installer --------------------------------------------
    Say ""
    $lockPath = Join-Path $PSScriptRoot "src-tauri\Cargo.lock"
    if (Test-Path $lockPath) {
        Say "Cargo.lock found - building with exact locked dependencies (reproducible)." "Green"
    } else {
        Say "First build: Cargo will generate Cargo.lock from the pinned versions." "Yellow"
        Say "KEEP that file (src-tauri\Cargo.lock) - it locks every dependency for" "Yellow"
        Say "identical rebuilds on any machine, forever." "Yellow"
    }
    Say ""
    Say "Building NICOFIRE installer (first build: 3-6 min)..." "Magenta"
    Say "You'll see many 'Compiling ...' lines - that's normal."
    & npm run build
    if ($LASTEXITCODE -ne 0) { Die "Build failed. Scroll up for the first red error and share it." }

    # Confirm the lock file now exists and remind the user to keep it
    if (Test-Path $lockPath) {
        Ok "Cargo.lock present - future builds are fully reproducible."
    }
}
finally { Pop-Location }

# --- 7. Locate + present the output -----------------------------------------
$bundle = Join-Path $PSScriptRoot "src-tauri\target\release\bundle"
$msi = Get-ChildItem -Path (Join-Path $bundle "msi")  -Filter *.msi  -ErrorAction SilentlyContinue | Select-Object -First 1
$exe = Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host ""
Write-Host "  =====================================================" -ForegroundColor Green
Write-Host "   BUILD COMPLETE" -ForegroundColor Green
Write-Host "  =====================================================" -ForegroundColor Green
Write-Host ""
if ($exe) { Say "One-click installer (recommended): " "White"; Write-Host "     $($exe.FullName)" -ForegroundColor Cyan }
if ($msi) { Say "MSI installer:                     " "White"; Write-Host "     $($msi.FullName)" -ForegroundColor Cyan }
Write-Host ""
Say "Give either file to ANY Windows PC. Double-click = installed." "White"
Say "No Rust, Node, Docker, or build tools needed on that PC." "White"
Write-Host ""

# Open the bundle folder in Explorer
if (Test-Path $bundle) { Start-Process explorer.exe -ArgumentList $bundle }
Read-Host "Press Enter to finish"
