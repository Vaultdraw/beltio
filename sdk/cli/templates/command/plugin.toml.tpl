id = "__ID__"
name = "__NAME__"
version = "0.1.0"
api = 1
min_api = "1.0.0"
main = "main.js"
permissions = []
description = "A Vaultdraw plugin."

[[contributes.commands]]
id = "hello"
title = "__NAME__: say hello"

[[contributes.settings]]
key = "greeting"
type = "string"
title = "Greeting"
default = "Hello"
