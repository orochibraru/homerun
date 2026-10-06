package cli

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const tfvarsFile = "terraform.tfvars"

// IacGenerateArgs are the options of `iac generate`: Scope is the API's
// stack:<ref> or service:<ref>, Project the state project for the backend,
// and Out, Zip or Stdout where the project goes.
type IacGenerateArgs struct {
	Force   bool
	Out     string
	Project string
	Scope   string
	Stdout  bool
	Zip     string
}

// GeneratedFile is one file of a generated Terraform project.
type GeneratedFile struct {
	Content string `json:"content"`
	Path    string `json:"path"`
}

// GeneratedProject is a Terraform project as GET /iac/generate returns it.
type GeneratedProject struct {
	Files []GeneratedFile `json:"files"`
	Name  string          `json:"name"`
	Slug  string          `json:"slug"`
}

var iacCommands = []Command{
	{
		Name:    "iac generate",
		Summary: "write a Terraform project for one stack or service, with import blocks for what already runs",
		Setup: func(set *flag.FlagSet) Runner {
			stack := set.String("stack", "", "generate for this stack, by `id|slug`")
			service := set.String("service", "", "generate for this service, by `id|slug`")
			project := set.String("state-project", "", "add an http backend pointing at this Terraform state project `id`")
			out := set.String("out", "", "write the files into this `dir` (default ./<slug>-terraform)")
			zip := set.String("zip", "", "save the project as a zip `file` instead")
			stdout := set.Bool("stdout", false, "print every file instead of writing them")
			force := set.Bool("force", false, "overwrite files that already exist")
			return func(env Env, _ []string) {
				if (*stack == "") == (*service == "") {
					Fail("Pass exactly one of --stack or --service.")
				}
				scope := "stack:" + *stack
				if *service != "" {
					scope = "service:" + *service
				}
				outputs := 0
				for _, chosen := range []bool{*out != "", *zip != "", *stdout} {
					if chosen {
						outputs++
					}
				}
				if outputs > 1 {
					Fail("--out, --zip and --stdout can't be combined.")
				}
				IacGenerate(env.Client(), IacGenerateArgs{
					Force: *force, Out: *out, Project: *project, Scope: scope, Stdout: *stdout, Zip: *zip,
				})
			}
		},
	},
	{
		Args:    "<project>",
		Name:    "iac state pull",
		Summary: "print a Terraform state project's latest state to stdout",
		Setup:   noFlags(func(env Env, args []string) { IacStatePull(env.Client(), args[0]) }),
	},
	{
		Args:    "<project>",
		Name:    "iac unlock",
		Summary: "break a Terraform state project's lock, whoever holds it, asking first unless --yes",
		Setup: func(set *flag.FlagSet) Runner {
			force := set.Bool("force", false, "required: confirms breaking a lock another run may still hold")
			yes := set.Bool("yes", false, "don't ask for confirmation")
			return func(env Env, args []string) {
				if !*force {
					Fail("--force is required: unlocking breaks a lock a running terraform may still hold.")
				}
				if !*yes && !Confirm(fmt.Sprintf("Break the lock on state project %s?", args[0])) {
					Fail("Still locked. Pass --yes to unlock without asking.")
					return
				}
				IacUnlock(env.Client(), args[0])
			}
		},
	},
}

// IacGenerate fetches a generated Terraform project and writes it out: into a
// directory (refusing to overwrite unless Force), as a zip, or to stdout with
// a `# ==> <path> <==` header per file. terraform.tfvars, which holds secret
// values, and the zip are written 0600, everything else 0644.
func IacGenerate(client *Client, args IacGenerateArgs) {
	query := url.Values{"scope": {args.Scope}}
	if args.Project != "" {
		query.Set("project", args.Project)
	}
	if args.Zip != "" {
		query.Set("format", "zip")
		body, _ := client.do("GET", "/iac/generate", query)
		if err := writeFile(args.Zip, body, 0o600, args.Force); err != nil {
			Fail(err.Error())
		}
		fmt.Printf("Saved %s (%d bytes).\n", args.Zip, len(body))
		fmt.Printf("It includes %s, which holds secret values: keep it private.\n", tfvarsFile)
		return
	}
	var project GeneratedProject
	client.decode("GET", "/iac/generate", query, &project)
	if args.Stdout {
		for index, file := range project.Files {
			if index > 0 {
				fmt.Println()
			}
			fmt.Printf("# ==> %s <==\n%s", file.Path, file.Content)
			if !strings.HasSuffix(file.Content, "\n") {
				fmt.Println()
			}
		}
		return
	}
	dir := args.Out
	if dir == "" {
		if !filepath.IsLocal(project.Slug) || strings.ContainsAny(project.Slug, `/\`) {
			Fail(fmt.Sprintf("The instance answered with an unusable slug %q: pass --out.", project.Slug))
		}
		dir = project.Slug + "-terraform"
	}
	if err := WriteProject(dir, project.Files, args.Force); err != nil {
		Fail(err.Error())
	}
	fmt.Printf("Wrote %d files to %s:\n", len(project.Files), dir)
	hasSecrets := false
	for _, file := range project.Files {
		fmt.Println("  " + file.Path)
		hasSecrets = hasSecrets || file.Path == tfvarsFile
	}
	if hasSecrets {
		fmt.Printf("\n%s holds secret values (mode 0600): keep it out of git, the generated .gitignore does.\n", tfvarsFile)
	}
	fmt.Println("\nNext:")
	fmt.Println("  export HOMERUN_API_KEY=<an API key>")
	if args.Project != "" {
		fmt.Println("  export TF_HTTP_PASSWORD=$HOMERUN_API_KEY")
	}
	fmt.Printf("  cd %s && terraform init && terraform plan\n", dir)
}

// WriteProject writes files under dir, creating it and any subdirectory.
// Unless force is set it writes nothing when any of them already exists, and
// it refuses a path that would land outside dir.
func WriteProject(dir string, files []GeneratedFile, force bool) error {
	existing := []string{}
	for _, file := range files {
		if !filepath.IsLocal(filepath.FromSlash(file.Path)) {
			return fmt.Errorf("refusing to write %q outside %s", file.Path, dir)
		}
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(file.Path))); err == nil {
			existing = append(existing, file.Path)
		}
	}
	if len(existing) > 0 && !force {
		return fmt.Errorf("%s already has %s: pass --force to overwrite", dir, strings.Join(existing, ", "))
	}
	for _, file := range files {
		target := filepath.Join(dir, filepath.FromSlash(file.Path))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		mode := fs.FileMode(0o644)
		if filepath.Base(target) == tfvarsFile {
			mode = 0o600
		}
		if err := writeFile(target, []byte(file.Content), mode, true); err != nil {
			return err
		}
	}
	return nil
}

func writeFile(path string, content []byte, mode fs.FileMode, overwrite bool) error {
	if _, err := os.Stat(path); err == nil && !overwrite {
		return fmt.Errorf("%s already exists: pass --force to overwrite it", path)
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.WriteFile(path, content, mode); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}

// IacStatePull writes a state project's latest state to stdout exactly as
// stored, or says on stderr that there's none yet (the API's 204).
func IacStatePull(client *Client, project string) {
	body, _ := client.do("GET", "/iac/projects/"+url.PathEscape(project)+"/state", nil)
	if len(body) == 0 {
		fmt.Fprintln(os.Stderr, "No state yet: nothing has been applied with this project.")
		return
	}
	if _, err := os.Stdout.Write(body); err != nil {
		Fail(err.Error())
	}
}

// IacUnlock force-releases a state project's lock. Exits on an API error.
func IacUnlock(client *Client, project string) {
	client.do("DELETE", "/iac/projects/"+url.PathEscape(project)+"/lock", url.Values{"force": {"true"}})
	fmt.Printf("Unlocked state project %s.\n", project)
}
