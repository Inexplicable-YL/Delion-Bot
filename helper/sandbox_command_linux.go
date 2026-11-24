package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	linuxSandboxLauncher    = "/usr/bin/bwrap"
	linuxCommandOutputLimit = 128 * 1024
)

type linuxCommandResult struct {
	ExitCode    *int   `json:"exitCode"`
	Output      string `json:"output"`
	Error       string `json:"error,omitempty"`
	launchError string
}

func (s *server) handleScopedCommand(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Command string
		Inputs  [][]byte
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 12*1024*1024)).Decode(&input); err != nil ||
		input.Command == "" || len(input.Command) > 6000 || strings.ContainsRune(input.Command, '\x00') || len(input.Inputs) > 8 {
		writeError(w, http.StatusBadRequest, "bad_request", "命令输入无效")
		return
	}
	total := 0
	for _, data := range input.Inputs {
		total += len(data)
	}
	if total > 8*1024*1024 {
		writeError(w, http.StatusBadRequest, "bad_request", "命令输入文件超过 8 MiB")
		return
	}
	writeJSON(w, http.StatusOK, runLinuxSandboxCommand(r.Context(), input.Command, input.Inputs))
}

func linuxCommandFilter() []syscall.SockFilter {
	var architecture uint32
	var platformCalls []uint32
	switch runtime.GOARCH {
	case "amd64":
		architecture = 0xc000003e
		const (
			open       = 2
			stat       = 4
			lstat      = 6
			poll       = 7
			access     = 21
			dup        = 32
			dup2       = 33
			readlink   = 89
			getpgrp    = 111
			archPrctl  = 158
			newfstatat = 262
			getrandom  = 318
		)
		platformCalls = []uint32{open, stat, lstat, poll, access, dup, dup2, readlink, getpgrp, archPrctl, newfstatat, getrandom}
	case "arm64":
		architecture = 0xc00000b7
		const fstatat, getrandom = 79, 278
		platformCalls = []uint32{fstatat, getrandom}
	default:
		return nil
	}
	allowed := append(platformCalls,
		syscall.SYS_READ, syscall.SYS_WRITE, syscall.SYS_CLOSE, syscall.SYS_READV, syscall.SYS_WRITEV,
		syscall.SYS_FSTAT, syscall.SYS_LSEEK, syscall.SYS_OPENAT, syscall.SYS_FACCESSAT,
		syscall.SYS_READLINKAT, syscall.SYS_GETDENTS64, syscall.SYS_GETCWD, syscall.SYS_CHDIR,
		syscall.SYS_DUP3, syscall.SYS_FCNTL, syscall.SYS_PPOLL,
		syscall.SYS_BRK, syscall.SYS_MMAP, syscall.SYS_MUNMAP, syscall.SYS_MPROTECT,
		syscall.SYS_MREMAP, syscall.SYS_MADVISE, syscall.SYS_FUTEX, syscall.SYS_SET_TID_ADDRESS,
		syscall.SYS_SET_ROBUST_LIST, syscall.SYS_GETRLIMIT, syscall.SYS_PRLIMIT64,
		syscall.SYS_CLOCK_GETTIME, syscall.SYS_NANOSLEEP, syscall.SYS_CLOCK_NANOSLEEP,
		syscall.SYS_RT_SIGACTION, syscall.SYS_RT_SIGPROCMASK, syscall.SYS_RT_SIGRETURN,
		syscall.SYS_GETPID, syscall.SYS_GETPPID, syscall.SYS_GETUID, syscall.SYS_GETEUID,
		syscall.SYS_GETGID, syscall.SYS_GETEGID, syscall.SYS_GETPGID, syscall.SYS_GETTID,
		syscall.SYS_EXECVE, syscall.SYS_EXIT, syscall.SYS_EXIT_GROUP,
	)
	const (
		loadAbsoluteWord = 0x20
		jumpEqual        = 0x15
		returnConstant   = 0x06
		killProcess      = 0x80000000
		allow            = 0x7fff0000
		returnErrno      = 0x00050000
	)
	filter := []syscall.SockFilter{
		{Code: loadAbsoluteWord, K: 4},
		{Code: jumpEqual, Jt: 1, K: architecture},
		{Code: returnConstant, K: killProcess},
		{Code: loadAbsoluteWord},
	}
	for _, number := range allowed {
		filter = append(filter, syscall.SockFilter{Code: jumpEqual, Jf: 1, K: number}, syscall.SockFilter{Code: returnConstant, K: allow})
	}
	return append(filter, syscall.SockFilter{Code: returnConstant, K: returnErrno | uint32(syscall.ENOSYS)})
}

type linuxCommandOutput struct {
	buffer    bytes.Buffer
	truncated bool
}

func (output *linuxCommandOutput) Write(p []byte) (int, error) {
	remaining := linuxCommandOutputLimit - output.buffer.Len()
	if len(p) > remaining {
		output.buffer.Write(p[:remaining])
		output.truncated = true
		return remaining, errors.New("sandbox command output limit")
	}
	return output.buffer.Write(p)
}

func runLinuxSandboxCommand(ctx context.Context, command string, copies [][]byte) linuxCommandResult {
	unavailable := linuxCommandResult{Error: "Linux 命令隔离无法建立"}
	filter := linuxCommandFilter()
	if len(filter) == 0 {
		return unavailable
	}
	launcher, err := os.Stat(linuxSandboxLauncher)
	if err != nil || !launcher.Mode().IsRegular() || launcher.Mode()&(os.ModeSetuid|os.ModeSetgid|0022) != 0 || launcher.Sys().(*syscall.Stat_t).Uid != 0 {
		return unavailable
	}
	work, err := os.MkdirTemp("", "delion-command-")
	if err != nil {
		return unavailable
	}
	defer os.RemoveAll(work)
	inputs := filepath.Join(work, "inputs")
	if os.Mkdir(inputs, 0700) != nil {
		return unavailable
	}
	for index, data := range copies {
		if ctx.Err() != nil || os.WriteFile(filepath.Join(inputs, strconv.Itoa(index+1)), data, 0400) != nil {
			return unavailable
		}
	}
	policy, err := os.OpenFile(filepath.Join(work, "policy"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return unavailable
	}
	defer policy.Close()
	if err := binary.Write(policy, binary.LittleEndian, filter); err != nil {
		return unavailable
	}
	if _, err := policy.Seek(0, 0); err != nil {
		return unavailable
	}
	arguments := []string{
		"--unshare-user", "--disable-userns", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts",
		"--cap-drop", "ALL", "--die-with-parent", "--new-session", "--clearenv", "--setenv", "PATH", "/bin", "--setenv", "LC_ALL", "C",
		"--ro-bind", inputs, "/work/inputs", "--chdir", "/work", "--seccomp", "3",
	}
	for _, dir := range []string{"/lib", "/lib64", "/usr/lib"} {
		arguments = append(arguments, "--ro-bind-try", dir, dir)
	}
	for _, program := range []string{"bash", "cat", "ls", "awk", "grep", "sed", "sort", "wc"} {
		destination := "/bin/" + program
		arguments = append(arguments, "--ro-bind-try", destination, destination)
	}
	arguments = append(arguments, "--remount-ro", "/", "--", "/bin/bash", "--noprofile", "--norc", "-c", command)
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, linuxSandboxLauncher, arguments...)
	child.Env = []string{}
	child.ExtraFiles = []*os.File{policy}
	var output linuxCommandOutput
	child.Stdout = &output
	child.Stderr = &output
	err = child.Run()
	if ctx.Err() != nil {
		return linuxCommandResult{Error: "命令已取消或超时"}
	}
	if output.truncated {
		return linuxCommandResult{Error: "命令输出超过限制"}
	}
	if child.ProcessState == nil {
		unavailable.launchError = err.Error()
		return unavailable
	}
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || bytes.HasPrefix(output.buffer.Bytes(), []byte("bwrap:")) {
			unavailable.launchError = output.buffer.String()
			return unavailable
		}
	}
	exitCode := child.ProcessState.ExitCode()
	return linuxCommandResult{ExitCode: &exitCode, Output: output.buffer.String()}
}
