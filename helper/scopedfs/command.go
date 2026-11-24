package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"time"
)

const commandOutputLimit = 128 * 1024

type commandRequest struct {
	Command string
	Inputs  [][]byte
}

type commandResponse struct {
	ExitCode *uint32 `json:"exitCode"`
	Output   string  `json:"output"`
	Error    string  `json:"error,omitempty"`
}

func executeCommand() {
	reader := bufio.NewReader(os.Stdin)
	decoder := json.NewDecoder(io.LimitReader(reader, 12*1024*1024))
	var request commandRequest
	if err := decoder.Decode(&request); err != nil || request.Command == "" || len(request.Command) > 6000 || len(request.Inputs) > 8 {
		json.NewEncoder(os.Stdout).Encode(commandResponse{Error: "命令输入无效"})
		return
	}
	total := 0
	for _, input := range request.Inputs {
		total += len(input)
	}
	if total > 8*1024*1024 {
		json.NewEncoder(os.Stdout).Encode(commandResponse{Error: "命令输入文件超过 8 MiB"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	go func() {
		reader.ReadByte()
		cancel()
	}()
	json.NewEncoder(os.Stdout).Encode(runCommand(ctx, request))
}
