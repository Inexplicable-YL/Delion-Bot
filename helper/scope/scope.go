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
	Action     string
	Path       string
	Content    string
	Data       []byte
	OldText    string
	Pattern    string
	Glob       string
	MaxDepth   *int
	FilesOnly  bool
	SkipHidden bool
	Limit      int64
	LineOffset int64
	LineLimit  int64
	ByteOffset *int64
	Writable   bool
}

type Response struct {
	Data           []byte   `json:"data,omitempty"`
	NextOffset     int64    `json:"nextOffset,omitempty"`
	NextByteOffset int64    `json:"nextByteOffset,omitempty"`
	SkippedFiles   int      `json:"skippedFiles,omitempty"`
	Entries        []string `json:"entries,omitempty"`
	Kind           string   `json:"kind,omitempty"`
	Matches        []Match  `json:"matches,omitempty"`
	Limited        bool     `json:"limited,omitempty"`
	Error          string   `json:"error,omitempty"`
}

func Run(ctx context.Context, directory string, input Request) Response {
	if ctx.Err() != nil {
		return Response{Error: "Operation cancelled."}
	}
	if !filepath.IsAbs(directory) {
		return Response{Error: "The authorized directory is unavailable."}
	}
	before, err := os.Lstat(directory)
	if err != nil || !before.IsDir() {
		return Response{Error: "The authorized directory is unavailable."}
	}
	for child, parent := directory, filepath.Dir(directory); child != parent; child, parent = parent, filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() {
			return Response{Error: "The authorized directory is unavailable."}
		}
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return Response{Error: "The authorized directory is unavailable."}
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return Response{Error: "The authorized directory is unavailable."}
	}
	return execute(ctx, root, input)
}

func execute(ctx context.Context, root *os.Root, input Request) Response {
	if !fs.ValidPath(input.Path) || strings.ContainsAny(input.Path, "\\:\x00") {
		return Response{Error: "The path is outside the authorized directory."}
	}
	for _, segment := range strings.Split(input.Path, "/") {
		if internalName(segment) {
			return Response{Error: "The path is outside the authorized directory."}
		}
	}
	writes := input.Action == "write" || input.Action == "create" || input.Action == "edit" || input.Action == "mkdir" || input.Action == "delete"
	if writes && (!input.Writable || input.Path == ".") {
		return Response{Error: "This operation has no write permission."}
	}
	dir, err := openDirectory(root, path.Dir(input.Path), input.Action == "write" || input.Action == "mkdir")
	if err != nil {
		return Response{Error: "Unable to open the authorized directory."}
	}
	defer dir.Close()
	name := path.Base(input.Path)
	switch input.Action {
	case "find", "grep":
		if input.Action == "grep" {
			if info, err := dir.Lstat(name); err == nil && info.Mode().IsRegular() {
				return grepFile(ctx, dir, name, input)
			}
		}
		dir, err := openDirectory(dir, name, false)
		if err != nil {
			return Response{Error: "Unable to open the directory."}
		}
		defer dir.Close()
		return search(ctx, dir, input)
	case "stat":
		info, err := dir.Lstat(name)
		if err != nil {
			return Response{Error: "The file or directory is unavailable."}
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
		return Response{Error: "Only regular files and directories are accessible."}
	case "read":
		if input.Limit <= 0 || input.Limit > maxSize {
			return Response{Error: "Invalid read limit."}
		}
		if input.LineOffset != 0 || input.LineLimit != 0 || input.ByteOffset != nil {
			return readPage(ctx, dir, name, input)
		}
		data, err := readFile(dir, name, input.Limit)
		if err != nil {
			return Response{Error: "Unable to read the file or the file exceeds the size limit."}
		}
		return Response{Data: data}
	case "ls":
		dir, err := openDirectory(dir, name, false)
		if err != nil {
			return Response{Error: "Unable to open the directory."}
		}
		defer dir.Close()
		file, err := openRegular(dir, ".")
		if err != nil {
			return Response{Error: "Unable to list the directory."}
		}
		defer file.Close()
		const limit = 1000
		var entries []string
		for {
			names, err := file.Readdirnames(limit + 1 - len(entries))
			if err != nil && !errors.Is(err, io.EOF) {
				return Response{Error: "Unable to list the directory."}
			}
			for _, name := range names {
				if !internalName(name) {
					entries = append(entries, name)
				}
			}
			if len(entries) > limit {
				return Response{Entries: entries[:limit], Limited: true}
			}
			if errors.Is(err, io.EOF) {
				return Response{Entries: entries}
			}
		}
	case "mkdir":
		created, err := openDirectory(dir, name, true)
		if err != nil {
			return Response{Error: "Unable to create the directory."}
		}
		created.Close()
		return Response{}
	case "delete":
		file, err := openVerifiedFile(dir, name)
		if err != nil {
			return Response{Error: "Only regular files can be deleted."}
		}
		file.Close()
		if ctx.Err() != nil || dir.Remove(name) != nil {
			return Response{Error: "Unable to delete the file."}
		}
		return Response{}
	case "write", "create", "edit":
		data := []byte(input.Content)
		if input.Action != "edit" && input.Data != nil {
			data = input.Data
		}
		var mode fs.FileMode = 0600
		info, err := dir.Lstat(name)
		switch {
		case err == nil && info.Mode().IsRegular() && input.Action != "create":
			mode = info.Mode().Perm()
		case errors.Is(err, fs.ErrNotExist) && input.Action != "edit":
		default:
			return Response{Error: "Only regular files can be modified."}
		}
		if input.Action == "edit" {
			before, err := readFile(dir, name, maxSize)
			if err != nil || input.OldText == "" || bytes.Count(before, []byte(input.OldText)) != 1 {
				return Response{Error: "The source text must appear exactly once in a readable file."}
			}
			data = bytes.Replace(before, []byte(input.OldText), data, 1)
		}
		if len(data) > maxSize || saveFile(ctx, dir, name, data, mode, input.Action == "create") != nil {
			return Response{Error: "Unable to write the file or the file exceeds the size limit."}
		}
		return Response{}
	default:
		return Response{Error: "Unsupported file operation."}
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

func saveFile(ctx context.Context, dir *os.Root, name string, data []byte, mode fs.FileMode, create bool) error {
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
	if create {
		return dir.Link(staged, name)
	}
	return dir.Rename(staged, name)
}
