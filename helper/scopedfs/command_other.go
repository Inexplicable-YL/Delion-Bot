//go:build !windows

package main

import "context"

func runCommand(context.Context, commandRequest) commandResponse {
	return commandResponse{Error: "此平台不支持此受限命令后端"}
}
