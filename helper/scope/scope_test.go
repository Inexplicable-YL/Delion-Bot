package scope

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadPagesAndIncompleteSearch(t *testing.T) {
	dir := t.TempDir()
	large := strings.Repeat("first\n", 34_000) + "target"
	if err := os.WriteFile(filepath.Join(dir, "large.txt"), []byte(large), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "small.txt"), []byte("target"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	read := Request{Action: "read", Path: "large.txt", Limit: 200_000, LineOffset: 34_000, LineLimit: 1}
	first := Run(ctx, dir, read)
	if string(first.Data) != "first\n" || first.NextOffset != 34_001 {
		t.Fatalf("first page: %+v", first)
	}
	read.LineOffset = first.NextOffset
	last := Run(ctx, dir, read)
	if string(last.Data) != "target" || last.NextOffset != 0 {
		t.Fatalf("last page: %+v", last)
	}
	read.LineOffset++
	if past := Run(ctx, dir, read); !strings.Contains(past.Error, "34001 lines total") {
		t.Fatalf("offset past an unterminated last line: %+v", past)
	}
	read.Path, read.LineOffset = "small.txt", 2
	if err := os.WriteFile(filepath.Join(dir, read.Path), []byte("target\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if past := Run(ctx, dir, read); !strings.Contains(past.Error, "1 lines total") {
		t.Fatalf("offset past a newline-terminated last line: %+v", past)
	}
	search := Run(ctx, dir, Request{Action: "grep", Path: ".", Pattern: "target"})
	if !search.Limited || search.SkippedFiles != 1 || len(search.Matches) != 1 || search.Matches[0].Path != "small.txt" {
		t.Fatalf("incomplete search: %+v", search)
	}
}

func TestScopedFileOperations(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	tests := []struct {
		name  string
		input Request
		want  string
		fails bool
	}{
		{"unapproved", Request{Action: "write", Path: "report.txt", Content: "before"}, "", true},
		{"write", Request{Action: "write", Path: "notes/report.txt", Content: "before", Writable: true}, "", false},
		{"edit", Request{Action: "edit", Path: "notes/report.txt", OldText: "before", Content: "after", Writable: true}, "", false},
		{"create never overwrites", Request{Action: "create", Path: "notes/report.txt", Content: "overwrite", Writable: true}, "", true},
		{"read", Request{Action: "read", Path: "notes/report.txt", Limit: 32}, "after", false},
		{"read bound", Request{Action: "read", Path: "notes/report.txt", Limit: 2}, "", true},
		{"parent", Request{Action: "write", Path: "../report.txt", Writable: true}, "", true},
		{"alternate stream", Request{Action: "read", Path: "notes/report.txt:hidden", Limit: 32}, "", true},
		{"repository metadata", Request{Action: "write", Path: ".git/config", Content: "config", Writable: true}, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := execute(context.Background(), root, tt.input)
			if (got.Error != "") != tt.fails || string(got.Data) != tt.want {
				t.Errorf("got %+v, want data %q, error=%t", got, tt.want, tt.fails)
			}
		})
	}
	if got := execute(context.Background(), root, Request{Action: "ls", Path: "notes"}); len(got.Entries) != 1 || got.Entries[0] != "report.txt" {
		t.Errorf("unexpected entries: %+v", got)
	}
	if got := execute(context.Background(), root, Request{Action: "find", Path: ".", Pattern: "*.txt"}); len(got.Entries) != 1 || got.Entries[0] != "notes/report.txt" {
		t.Errorf("unexpected search: %+v", got)
	}
	if got := execute(context.Background(), root, Request{Action: "grep", Path: "notes", Pattern: "^after$"}); len(got.Matches) != 1 || got.Matches[0].Path != "notes/report.txt" || got.Matches[0].Line != 1 {
		t.Errorf("unexpected matches: %+v", got)
	}
	if got := execute(context.Background(), root, Request{Action: "grep", Path: "notes/report.txt", Pattern: "^after$"}); len(got.Matches) != 1 || got.Matches[0].Path != "notes/report.txt" {
		t.Errorf("unexpected file matches: %+v", got)
	}
}

func TestCreateAndDeleteRequireWritePermission(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	ctx := context.Background()
	for _, input := range []Request{
		{Action: "create", Path: "new.txt", Content: "text"},
		{Action: "delete", Path: "new.txt"},
	} {
		if got := execute(ctx, root, input); got.Error == "" {
			t.Fatalf("accepted unapproved %s", input.Action)
		}
	}
	for _, action := range []string{"create", "read", "delete"} {
		got := execute(ctx, root, Request{Action: action, Path: "new.txt", Content: "text", Limit: 32, Writable: true})
		if got.Error != "" || (action == "read" && string(got.Data) != "text") {
			t.Fatalf("%s: %+v", action, got)
		}
	}
	if _, err := root.Stat("new.txt"); !os.IsNotExist(err) {
		t.Fatalf("deleted file is still present: %v", err)
	}
}

func TestExternalLinksStayOutsideScope(t *testing.T) {
	dir, external := t.TempDir(), t.TempDir()
	secret := filepath.Join(external, "secret.txt")
	if err := os.WriteFile(secret, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	t.Run("hard link", func(t *testing.T) {
		if err := os.Link(secret, filepath.Join(dir, "hard")); err != nil {
			t.Fatal(err)
		}
		if got := execute(context.Background(), root, Request{Action: "read", Path: "hard", Limit: 32}); got.Error == "" {
			t.Fatal("read followed a hard link")
		}
		if got := execute(context.Background(), root, Request{Action: "write", Path: "hard", Content: "new", Writable: true}); got.Error != "" {
			t.Fatal(got.Error)
		}
	})
	t.Run("external directory link", func(t *testing.T) {
		if err := os.Symlink(external, filepath.Join(dir, "outside")); err != nil {
			t.Skip(err)
		}
		for _, action := range []string{"read", "write", "edit"} {
			got := execute(context.Background(), root, Request{Action: action, Path: "outside/secret.txt", Limit: 32, Writable: true})
			if got.Error == "" {
				t.Errorf("%s followed the external directory link", action)
			}
		}
	})
	if body, err := os.ReadFile(secret); err != nil || string(body) != "outside" {
		t.Fatalf("external file changed: %q, %v", body, err)
	}
}

func TestAuthorizedRootCannotBeALink(t *testing.T) {
	parent, outside := t.TempDir(), t.TempDir()
	root := filepath.Join(parent, "scope")
	if err := os.Symlink(outside, root); err != nil {
		t.Skip(err)
	}
	if err := os.Mkdir(filepath.Join(outside, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, alias := range []string{root, filepath.Join(root, "nested")} {
		if got := Run(context.Background(), alias, Request{Action: "ls", Path: "."}); got.Error == "" {
			t.Fatal("an alias replaced the authorized directory")
		}
	}
}
