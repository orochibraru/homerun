// Command terraform-provider-homerun serves the Homerun Terraform provider
// to Terraform or OpenTofu over the plugin protocol.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/orochibraru/homerun/terraform/provider/internal/provider"
)

var version = "dev"

func main() {
	debug := flag.Bool("debug", false, "Run with support for debuggers like delve.")
	flag.Parse()
	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/orochibraru/homerun",
		Debug:   *debug,
	})
	if err != nil {
		log.Fatal(err)
	}
}
