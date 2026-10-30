#!/bin/sh
# Tauri's rpm lists only /usr/lib/Vaultdraw itself, not the folders under it: remove them on uninstall (not on upgrade).
if [ "$1" = 0 ]; then rm -rf /usr/lib/Vaultdraw; fi
exit 0
