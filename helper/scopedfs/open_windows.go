package main

import (
	"io/fs"
	"os"
	"syscall"
)

func openRegular(root *os.Root, name string) (*os.File, error) {
	return root.Open(name)
}

func linkedFile(file *os.File, _ fs.FileInfo) bool {
	var info syscall.ByHandleFileInformation
	err := syscall.GetFileInformationByHandle(syscall.Handle(file.Fd()), &info)
	return err != nil || info.NumberOfLinks != 1
}
