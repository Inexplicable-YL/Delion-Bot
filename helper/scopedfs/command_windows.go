package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const (
	attributeHandles              = 0x00020002
	attributeMitigation           = 0x00020007
	attributeSecurityCapabilities = 0x00020009
	attributeAllApplicationPolicy = 0x0002000F
	extendedStartupInfoPresent    = 0x00080000
	createSuspended               = 0x00000004
	createNoWindow                = 0x08000000
	appPackagesOptOut             = 1
	disableWin32k                 = 1 << 28
	jobActiveProcessLimit         = 0x00000008
	jobKillOnClose                = 0x00002000
	jobExtendedLimitInfo          = 9
)

var kernel32 = syscall.NewLazyDLL("kernel32.dll")

type commandStartupInfo struct {
	syscall.StartupInfo
	attributes unsafe.Pointer
}

type securityCapabilities struct {
	sid      *syscall.SID
	groups   uintptr
	count    uint32
	reserved uint32
}

type jobLimits struct {
	processTime, jobTime                                       int64
	flags                                                      uint32
	minimumWorkingSet, maximumWorkingSet                       uintptr
	activeProcessLimit                                         uint32
	affinity                                                   uintptr
	priority, scheduling                                       uint32
	ioCounters                                                 [6]uint64
	processMemory, jobMemory, peakProcessMemory, peakJobMemory uintptr
}

func wide(value string) *uint16 {
	pointer, _ := syscall.UTF16PtrFromString(value)
	return pointer
}

func systemDirectory() (string, error) {
	var path [260]uint16
	length, _, err := kernel32.NewProc("GetSystemDirectoryW").Call(uintptr(unsafe.Pointer(&path[0])), uintptr(len(path)))
	if length == 0 || length >= uintptr(len(path)) {
		return "", err
	}
	return syscall.UTF16ToString(path[:length]), nil
}

func appContainerProfile(system string) (string, *syscall.SID, func() error, error) {
	profileAPI := syscall.NewLazyDLL(filepath.Join(system, "userenv.dll"))
	freeAPI := syscall.NewLazyDLL(filepath.Join(system, "advapi32.dll")).NewProc("FreeSid")
	memoryAPI := syscall.NewLazyDLL(filepath.Join(system, "ole32.dll")).NewProc("CoTaskMemFree")
	var nonce [16]byte
	rand.Read(nonce[:])
	name := wide("Delion.Sandbox." + hex.EncodeToString(nonce[:]))
	var sid *syscall.SID
	create := profileAPI.NewProc("CreateAppContainerProfile")
	status, _, _ := create.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(name)), 0, 0, uintptr(unsafe.Pointer(&sid)))
	if status != 0 || sid == nil {
		return "", nil, nil, errors.New("无法创建 AppContainer")
	}
	cleanup := func() error {
		freeAPI.Call(uintptr(unsafe.Pointer(sid)))
		status, _, _ := profileAPI.NewProc("DeleteAppContainerProfile").Call(uintptr(unsafe.Pointer(name)))
		if status != 0 {
			return errors.New("无法清理 Windows 命令的临时目录")
		}
		return nil
	}
	sidText, err := sid.String()
	if err != nil {
		cleanup()
		return "", nil, nil, err
	}
	var storage *uint16
	status, _, _ = profileAPI.NewProc("GetAppContainerFolderPath").Call(
		uintptr(unsafe.Pointer(wide(sidText))), uintptr(unsafe.Pointer(&storage)),
	)
	if status != 0 || storage == nil {
		cleanup()
		return "", nil, nil, errors.New("无法定位 AppContainer")
	}
	var size int
	for size < 32767 && *(*uint16)(unsafe.Add(unsafe.Pointer(storage), size*2)) != 0 {
		size++
	}
	root := syscall.UTF16ToString(unsafe.Slice(storage, size))
	memoryAPI.Call(uintptr(unsafe.Pointer(storage)))
	if !filepath.IsAbs(root) || size == 32767 {
		cleanup()
		return "", nil, nil, errors.New("无效的 AppContainer 目录")
	}
	return root, sid, cleanup, nil
}

func commandEnvironment(system, root string) []uint16 {
	windows := filepath.Dir(system)
	values := []string{
		"APPDATA=" + root, "LOCALAPPDATA=" + root, "PATH=" + system,
		"SystemDrive=" + filepath.VolumeName(system), "SystemRoot=" + windows,
		"TEMP=" + root, "TMP=" + root, "USERPROFILE=" + root, "windir=" + windows,
	}
	return utf16.Encode([]rune(strings.Join(values, "\x00") + "\x00\x00"))
}

func launchAppContainer(executable, arguments, system, root string, sid *syscall.SID, input, output syscall.Handle) (syscall.ProcessInformation, error) {
	var process syscall.ProcessInformation
	init := kernel32.NewProc("InitializeProcThreadAttributeList")
	update := kernel32.NewProc("UpdateProcThreadAttribute")
	free := kernel32.NewProc("DeleteProcThreadAttributeList")
	var bytes uintptr
	init.Call(0, 4, 0, uintptr(unsafe.Pointer(&bytes)))
	if bytes == 0 || bytes > 1<<20 {
		return process, errors.New("无法创建受限进程属性")
	}
	list := make([]byte, bytes)
	pointer := unsafe.Pointer(&list[0])
	ok, _, callErr := init.Call(uintptr(pointer), 4, 0, uintptr(unsafe.Pointer(&bytes)))
	if ok == 0 {
		return process, callErr
	}
	capabilities := securityCapabilities{sid: sid}
	packages := uint32(appPackagesOptOut)
	mitigation := uint64(disableWin32k)
	handles := [2]syscall.Handle{input, output}
	var pin runtime.Pinner
	defer pin.Unpin()
	pin.Pin(&list[0])
	defer free.Call(uintptr(pointer))
	pin.Pin(&capabilities)
	pin.Pin(&packages)
	pin.Pin(&mitigation)
	pin.Pin(&handles)
	attributes := []struct {
		key   uintptr
		value unsafe.Pointer
		size  uintptr
	}{
		{attributeSecurityCapabilities, unsafe.Pointer(&capabilities), unsafe.Sizeof(capabilities)},
		{attributeAllApplicationPolicy, unsafe.Pointer(&packages), unsafe.Sizeof(packages)},
		{attributeMitigation, unsafe.Pointer(&mitigation), unsafe.Sizeof(mitigation)},
		{attributeHandles, unsafe.Pointer(&handles), unsafe.Sizeof(handles)},
	}
	for _, attribute := range attributes {
		ok, _, callErr := update.Call(uintptr(pointer), 0, attribute.key, uintptr(attribute.value), attribute.size, 0, 0)
		if ok == 0 {
			return process, callErr
		}
	}
	commandLine, err := syscall.UTF16PtrFromString(syscall.EscapeArg(executable) + arguments)
	if err != nil {
		return process, err
	}
	environment := commandEnvironment(system, root)
	info := commandStartupInfo{attributes: pointer}
	info.Cb = uint32(unsafe.Sizeof(info))
	info.Flags = syscall.STARTF_USESTDHANDLES | syscall.STARTF_USESHOWWINDOW
	info.StdInput, info.StdOutput, info.StdErr = input, output, output
	err = syscall.CreateProcess(
		wide(executable), commandLine, nil, nil, true,
		createSuspended|createNoWindow|syscall.CREATE_UNICODE_ENVIRONMENT|extendedStartupInfoPresent,
		&environment[0], wide(root), &info.StartupInfo, &process,
	)
	return process, err
}

func singleProcessJob() (syscall.Handle, error) {
	job, _, callErr := kernel32.NewProc("CreateJobObjectW").Call(0, 0)
	if job == 0 {
		return 0, callErr
	}
	limits := jobLimits{flags: jobActiveProcessLimit | jobKillOnClose, activeProcessLimit: 1}
	ok, _, callErr := kernel32.NewProc("SetInformationJobObject").Call(job, jobExtendedLimitInfo, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		syscall.CloseHandle(syscall.Handle(job))
		return 0, callErr
	}
	return syscall.Handle(job), nil
}

func isAppContainer(process syscall.Handle) bool {
	var token syscall.Token
	if syscall.OpenProcessToken(process, syscall.TOKEN_QUERY, &token) != nil {
		return false
	}
	defer token.Close()
	var container, size uint32
	const (
		tokenIsAppContainer = 29
		tokenCapabilities   = 30
	)
	err := syscall.GetTokenInformation(token, tokenIsAppContainer, (*byte)(unsafe.Pointer(&container)), uint32(unsafe.Sizeof(container)), &size)
	if err != nil || container != 1 || size != uint32(unsafe.Sizeof(container)) {
		return false
	}
	var capabilities struct {
		count uint32
		align uintptr
	}
	err = syscall.GetTokenInformation(token, tokenCapabilities, (*byte)(unsafe.Pointer(&capabilities)), uint32(unsafe.Sizeof(capabilities)), &size)
	return err == nil && capabilities.count == 0
}

func runCommand(ctx context.Context, request commandRequest) commandResponse {
	response, err := runWindowsCommand(ctx, request)
	if err != nil {
		return commandResponse{Error: err.Error()}
	}
	return response
}

func runWindowsCommand(ctx context.Context, request commandRequest) (commandResponse, error) {
	return runWindowsProcess(ctx, request.Inputs, func(system, _ string) (string, string, error) {
		return filepath.Join(system, "cmd.exe"), ` /D /Q /S /C "` + request.Command + `"`, nil
	})
}

func runWindowsProcess(ctx context.Context, copies [][]byte, prepare func(system, root string) (string, string, error)) (result commandResponse, resultErr error) {
	if err := ctx.Err(); err != nil {
		return commandResponse{}, err
	}
	system, err := systemDirectory()
	if err != nil {
		return commandResponse{}, errors.New("无法定位 Windows 系统目录")
	}
	root, sid, cleanup, err := appContainerProfile(system)
	if err != nil {
		return commandResponse{}, errors.New("Windows 命令隔离无法建立 AppContainer")
	}
	defer func() {
		resultErr = errors.Join(resultErr, cleanup())
	}()
	inputs := filepath.Join(root, "inputs")
	if err := os.MkdirAll(inputs, 0700); err != nil {
		return commandResponse{}, errors.New("无法准备命令输入")
	}
	for index, data := range copies {
		if err := os.WriteFile(filepath.Join(inputs, strconv.Itoa(index+1)), data, 0400); err != nil {
			return commandResponse{}, errors.New("无法准备命令输入")
		}
	}
	executable, arguments, err := prepare(system, root)
	if err != nil {
		return commandResponse{}, err
	}
	job, err := singleProcessJob()
	if err != nil {
		return commandResponse{}, errors.New("无法建立进程生命周期限制")
	}
	defer syscall.CloseHandle(job)

	input, closedInput, err := os.Pipe()
	if err != nil {
		return commandResponse{}, errors.New("无法建立命令输入")
	}
	closedInput.Close()
	defer input.Close()
	capture, output, err := os.Pipe()
	if err != nil {
		return commandResponse{}, errors.New("无法建立命令输出")
	}
	defer capture.Close()
	defer output.Close()
	for _, file := range []*os.File{input, output} {
		if err := syscall.SetHandleInformation(syscall.Handle(file.Fd()), syscall.HANDLE_FLAG_INHERIT, syscall.HANDLE_FLAG_INHERIT); err != nil {
			return commandResponse{}, errors.New("无法限制命令继承的句柄")
		}
	}
	process, err := launchAppContainer(executable, arguments, system, root, sid, syscall.Handle(input.Fd()), syscall.Handle(output.Fd()))
	if err != nil {
		return commandResponse{}, errors.New("无法启动 Windows 受限命令")
	}
	defer syscall.CloseHandle(process.Thread)
	defer func() {
		syscall.TerminateProcess(process.Process, 126)
		syscall.WaitForSingleObject(process.Process, 2000)
		syscall.CloseHandle(process.Process)
	}()
	output.Close()
	ok, _, _ := kernel32.NewProc("AssignProcessToJobObject").Call(uintptr(job), uintptr(process.Process))
	if ok == 0 || !isAppContainer(process.Process) {
		return commandResponse{}, errors.New("无法确认 Windows 进程隔离")
	}
	if ctx.Err() != nil {
		return commandResponse{}, errors.New("操作已取消")
	}
	resumed, _, _ := kernel32.NewProc("ResumeThread").Call(uintptr(process.Thread))
	if resumed != 1 {
		return commandResponse{}, errors.New("无法运行 Windows 受限命令")
	}
	done := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(io.LimitReader(capture, commandOutputLimit+1))
		done <- data
	}()
	var data []byte
	for {
		select {
		case <-ctx.Done():
			return commandResponse{}, errors.New("命令已取消或超时")
		case data = <-done:
			done = nil
			if len(data) > commandOutputLimit {
				return commandResponse{}, errors.New("命令输出超过限制")
			}
		default:
		}
		wait, err := syscall.WaitForSingleObject(process.Process, 50)
		if err != nil {
			return commandResponse{}, errors.New("无法等待 Windows 受限命令")
		}
		if wait == syscall.WAIT_OBJECT_0 {
			break
		}
	}
	if done != nil {
		data = <-done
		if len(data) > commandOutputLimit {
			return commandResponse{}, errors.New("命令输出超过限制")
		}
	}
	var exitCode uint32
	if err := syscall.GetExitCodeProcess(process.Process, &exitCode); err != nil {
		return commandResponse{}, errors.New("无法读取 Windows 受限命令的结果")
	}
	return commandResponse{ExitCode: &exitCode, Output: strings.ReplaceAll(string(data), root, ".")}, nil
}
