#!/bin/bash
unset VIRTUAL_ENV
unset PYTHONPATH
cd "/Users/s/Desktop/claude code/report-tool"
exec /usr/bin/python3 -m http.server 8080
