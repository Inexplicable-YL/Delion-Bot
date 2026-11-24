//go:build linux || darwin

package scope

import (
	"io/fs"
	"os"
	"syscall"
)

func openRegular(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
}

func linkedFile(_ *os.File, info fs.FileInfo) bool {
	return info.Sys().(*syscall.Stat_t).Nlink != 1
}
