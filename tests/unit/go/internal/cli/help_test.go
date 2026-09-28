package cli_test

import (
	"flag"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

type helpExit struct{}

func runHelp(t *testing.T, args ...string) string {
	t.Helper()
	original := cli.Exit
	cli.Exit = func(code int) {
		if code != 0 {
			t.Errorf("--help should exit 0, got %d", code)
		}
		panic(helpExit{})
	}
	t.Cleanup(func() { cli.Exit = original })
	out, failed := runCLI(t, func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				if _, ok := recovered.(helpExit); !ok {
					panic(recovered)
				}
			}
		}()
		cli.Execute(cli.Env{Client: func() *cli.Client { t.Fatal("--help must not reach the API"); return nil }}, args)
	})
	if failed != "" {
		t.Fatalf("%v failed with %q", args, failed)
	}
	return out
}

func TestEveryCommandDocumentsItself(t *testing.T) {
	seen := map[string]bool{}
	for _, command := range cli.Commands {
		t.Run(command.Name, func(t *testing.T) {
			for _, name := range append([]string{command.Name}, command.Aliases...) {
				if seen[name] {
					t.Errorf("%q is registered twice", name)
				}
				seen[name] = true
			}
			if strings.TrimSpace(command.Summary) == "" {
				t.Error("no summary")
			}
			if _, err := cli.ParseArgs(command.Args); err != nil {
				t.Errorf("bad Args %q: %s", command.Args, err)
			}
			set := cli.NewFlagSet(command.Name)
			if command.Setup(set) == nil {
				t.Error("Setup returned no runner")
			}
			set.VisitAll(func(f *flag.Flag) {
				if strings.TrimSpace(f.Usage) == "" {
					t.Errorf("--%s has no description", f.Name)
				}
			})

			out := runHelp(t, append(strings.Fields(command.Name), "--help")...)
			if !strings.HasPrefix(out, "Usage: homerun "+cli.Synopsis(command)) || !strings.Contains(out, command.Summary) {
				t.Errorf("--help should print the synopsis and summary, got %q", out)
			}
			set.VisitAll(func(f *flag.Flag) {
				if !strings.Contains(out, "-"+f.Name) {
					t.Errorf("--help doesn't list --%s: %q", f.Name, out)
				}
			})
			if !strings.Contains(cli.Usage(), "  "+command.Name) {
				t.Error("missing from the top-level usage")
			}
		})
	}
}

func TestEveryRequiredArgumentIsChecked(t *testing.T) {
	isolate(t)
	for _, command := range cli.Commands {
		args, _ := cli.ParseArgs(command.Args)
		if len(args) == 0 || !args[0].Required {
			continue
		}
		t.Run(command.Name, func(t *testing.T) {
			_, failed := runCLI(t, func() { cli.Execute(cli.NewEnv(cli.GlobalFlags{}), strings.Fields(command.Name)) })
			if !strings.HasPrefix(failed, "missing <"+args[0].Name+">") {
				t.Errorf("want missing <%s>, got %q", args[0].Name, failed)
			}
		})
	}
}

func TestExtraArgumentsAreRejected(t *testing.T) {
	_, failed := runCLI(t, func() { cli.Execute(cli.NewEnv(cli.GlobalFlags{}), []string{"services", "get", "a", "b"}) })
	if !strings.HasPrefix(failed, `unexpected argument "b"`) {
		t.Errorf("got %q", failed)
	}
}

func TestGroupHelpListsTheGroup(t *testing.T) {
	out := runHelp(t, "backups", "--help")
	if !strings.Contains(out, "backups run <id|name>") || strings.Contains(out, "jobs") {
		t.Errorf("got %q", out)
	}
}

func TestAliasesResolve(t *testing.T) {
	for alias, want := range map[string]string{"deploy x": "services deploy", "service get x": "services get", "services scans x": "services scans list"} {
		args := strings.Fields(alias)
		if args[0] == "service" {
			args[0] = "services"
		}
		if command, _ := cli.Lookup(args); command == nil || command.Name != want {
			t.Errorf("%q should resolve to %q, got %+v", alias, want, command)
		}
	}
}

func TestParseArgsRejectsABadSynopsis(t *testing.T) {
	for _, synopsis := range []string{"id", "[a] <b>", "[a...] [b]", "<>"} {
		if _, err := cli.ParseArgs(synopsis); err == nil {
			t.Errorf("%q should be rejected", synopsis)
		}
	}
}
