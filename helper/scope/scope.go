package scope

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxSize = 5 * 1024 * 1024

type Request struct {
	Action   string
	Path     string
	Content  string
	Data     []byte
	OldText  string
	Pattern  string
	Limit    int64
	Writable bool
}

type Response struct {
	Data    []byte   `json:"data,omitempty"`
	Entries []string `json:"entries,omitempty"`
	Kind    string   `json:"kind,omitempty"`
	Matches []Match  `json:"matches,omitempty"`
	Limited bool     `json:"limited,omitempty"`
	Error   string   `json:"error,omitempty"`
}

func Run(ctx context.Context, directory string, input Request) Response {
	if ctx.Err() != nil {
		return Response{Error: "操作已取消"}
	}
	if !filepath.IsAbs(directory) {
		return Response{Error: "授权目录不可用"}
	}
	before, err := os.Lstat(directory)
	if err != nil || !before.IsDir() {
		return Response{Error: "授权目录不可用"}
	}
	for child, parent := directory, filepath.Dir(directory); child != parent; child, parent = parent, filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() {
			return Response{Error: "授权目录不可用"}
		}
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return Response{Error: "授权目录不可用"}
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return Response{Error: "授权目录不可用"}
	}
	return execute(ctx, root, input)
}

func execute(ctx context.Context, root *os.Root, input Request) Response {
	if !fs.ValidPath(input.Path) || strings.ContainsAny(input.Path, "\\:\x00") {
		return Response{Error: "路径超出授权目录"}
	}
	for _, segment := range strings.Split(input.Path, "/") {
		if internalName(segment) {
			return Response{Error: "路径超出授权目录"}
		}
	}
	writes := input.Action == "write" || input.Action == "edit"
	if writes && (!input.Writable || input.Path == ".") {
		return Response{Error: "当前操作没有写入权限"}
	}
	dir, err := openDirectory(root, path.Dir(input.Path), input.Action == "write")
	if err != nil {
		return Response{Error: "无法打开授权目录"}
	}
	defer dir.Close()
	name := path.Base(input.Path)
	switch input.Action {
	case "find", "grep":
		dir, err := openDirectory(dir, name, false)
		if err != nil {
			return Response{Error: "无法打开目录"}
		}
		defer dir.Close()
		return search(ctx, dir, input)
	case "stat":
		info, err := dir.Lstat(name)
		if err != nil {
			return Response{Error: "文件或目录不可用"}
		}
		if info.IsDir() {
			return Response{Kind: "directory"}
		}
		if info.Mode().IsRegular() {
			if file, err := openVerifiedFile(dir, name); err == nil {
				file.Close()
				return Response{Kind: "file"}
			}
		}
		return Response{Error: "只能访问普通文件和目录"}
	case "read":
		if input.Limit <= 0 || input.Limit > maxSize {
			return Response{Error: "无效的读取上限"}
		}
		data, err := readFile(dir, name, input.Limit)
		if err != nil {
			return Response{Error: "无法读取文件或文件超出大小限制"}
		}
		return Response{Data: data}
	case "ls":
		dir, err := openDirectory(dir, name, false)
		if err != nil {
			return Response{Error: "无法打开目录"}
		}
		defer dir.Close()
		file, err := openRegular(dir, ".")
		if err != nil {
			return Response{Error: "无法列出目录"}
		}
		defer file.Close()
		names, err := file.Readdirnames(1000)
		if err != nil && !errors.Is(err, io.EOF) {
			return Response{Error: "无法列出目录"}
		}
		entries := names[:0]
		for _, name := range names {
			if !internalName(name) {
				entries = append(entries, name)
			}
		}
		return Response{Entries: entries}
	case "write", "edit":
		data := []byte(input.Content)
		if input.Action == "write" && input.Data != nil {
			data = input.Data
		}
		var mode fs.FileMode = 0600
		info, err := dir.Lstat(name)
		switch {
		case err == nil && info.Mode().IsRegular():
			mode = info.Mode().Perm()
		case errors.Is(err, fs.ErrNotExist) && input.Action == "write":
		default:
			return Response{Error: "只能修改普通文件"}
		}
		if input.Action == "edit" {
			before, err := readFile(dir, name, maxSize)
			if err != nil || input.OldText == "" || bytes.Count(before, []byte(input.OldText)) != 1 {
				return Response{Error: "源文本必须在可读取的文件中恰好出现一次"}
			}
			data = bytes.Replace(before, []byte(input.OldText), data, 1)
		}
		if len(data) > maxSize || replaceFile(ctx, dir, name, data, mode) != nil {
			return Response{Error: "无法写入文件或文件超出大小限制"}
		}
		return Response{}
	default:
		return Response{Error: "不支持的文件操作"}
	}
}

func internalName(name string) bool {
	folded := strings.ToLower(strings.TrimRight(name, " ."))
	return folded == ".git" || (strings.HasPrefix(folded, "git~") && !strings.Contains(folded, "."))
}

func openDirectory(root *os.Root, name string, create bool) (*os.Root, error) {
	dir, err := root.OpenRoot(".")
	if err != nil || name == "." {
		return dir, err
	}
	for _, segment := range strings.Split(name, "/") {
		before, err := dir.Lstat(segment)
		if create && errors.Is(err, fs.ErrNotExist) {
			err = dir.Mkdir(segment, 0700)
			if err == nil || errors.Is(err, fs.ErrExist) {
				before, err = dir.Lstat(segment)
			}
		}
		if err != nil || !before.IsDir() {
			dir.Close()
			return nil, fs.ErrInvalid
		}
		next, err := dir.OpenRoot(segment)
		dir.Close()
		if err != nil {
			return nil, err
		}
		opened, err := next.Stat(".")
		if err != nil || !os.SameFile(before, opened) {
			next.Close()
			return nil, fs.ErrInvalid
		}
		dir = next
	}
	return dir, nil
}

func readFile(root *os.Root, name string, limit int64) ([]byte, error) {
	file, err := openVerifiedFile(root, name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, limit+1))
	if int64(len(body)) > limit {
		return nil, fs.ErrInvalid
	}
	return body, err
}

func openVerifiedFile(root *os.Root, name string) (*os.File, error) {
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() {
		return nil, fs.ErrInvalid
	}
	file, err := openRegular(root, name)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(opened, info) || linkedFile(file, opened) {
		file.Close()
		return nil, fs.ErrInvalid
	}
	return file, nil
}

func replaceFile(ctx context.Context, dir *os.Root, name string, data []byte, mode fs.FileMode) error {
	var nonce [16]byte
	rand.Read(nonce[:])
	staged := ".delion-" + hex.EncodeToString(nonce[:])
	file, err := dir.OpenFile(staged, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	defer dir.Remove(staged)
	_, writeErr := file.Write(data)
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return dir.Rename(staged, name)
}
