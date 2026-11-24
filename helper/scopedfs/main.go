package main

import (
	"context"
	"encoding/json"
	"io"
	"os"

	"github.com/Inexplicable-YL/delion-bot/helper/scope"
)

func main() {
	reply := scope.Response{Error: "文件操作失败"}
	if len(os.Args) == 2 {
		var input scope.Request
		decoder := json.NewDecoder(io.LimitReader(os.Stdin, 32*1024*1024))
		if decoder.Decode(&input) == nil {
			reply = scope.Run(context.Background(), os.Args[1], input)
		}
	}
	json.NewEncoder(os.Stdout).Encode(reply)
}
