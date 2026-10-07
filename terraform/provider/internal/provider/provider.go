// Package provider is the Homerun Terraform provider: a resource and a data
// source per entry of the spec the dashboard shares, over the REST API.
package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/orochibraru/homerun/terraform/provider/internal/client"
)

var _ provider.Provider = (*homerunProvider)(nil)

type homerunProvider struct {
	spec    Spec
	version string
}

type providerModel struct {
	APIKey   types.String `tfsdk:"api_key"`
	Endpoint types.String `tfsdk:"endpoint"`
}

// New returns the provider factory for version.
func New(version string) func() provider.Provider {
	spec, err := LoadSpec()
	if err != nil {
		panic("the embedded spec doesn't parse: " + err.Error())
	}
	return func() provider.Provider {
		return &homerunProvider{spec: spec, version: version}
	}
}

func (p *homerunProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "homerun"
	resp.Version = p.version
}

func (p *homerunProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"api_key": schema.StringAttribute{
				Description: "An API key (Profile → Authorized Clients). Defaults to HOMERUN_API_KEY.",
				Optional:    true,
				Sensitive:   true,
			},
			"endpoint": schema.StringAttribute{
				Description: "The instance's URL, e.g. https://homerun.example.com. Defaults to HOMERUN_ENDPOINT.",
				Optional:    true,
			},
		},
		Description: "Manages a Homerun instance: stacks, services and every setting the dashboard has.",
	}
}

func (p *homerunProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var config providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if config.Endpoint.IsUnknown() || config.APIKey.IsUnknown() {
		resp.Diagnostics.AddError("Unknown provider settings", "endpoint and api_key must be known when planning.")
		return
	}
	endpoint := firstSet(config.Endpoint.ValueString(), os.Getenv("HOMERUN_ENDPOINT"))
	apiKey := firstSet(config.APIKey.ValueString(), os.Getenv("HOMERUN_API_KEY"))
	if apiKey == "" {
		resp.Diagnostics.AddError("Missing API key", "Set api_key or HOMERUN_API_KEY.")
		return
	}
	apiClient, err := client.New(endpoint, apiKey)
	if err != nil {
		resp.Diagnostics.AddError("Invalid endpoint", "Set endpoint or HOMERUN_ENDPOINT: "+err.Error())
		return
	}
	resp.DataSourceData = apiClient
	resp.ResourceData = apiClient
}

func (p *homerunProvider) Resources(_ context.Context) []func() resource.Resource {
	out := make([]func() resource.Resource, 0, len(p.spec.Resources))
	for _, spec := range p.spec.Resources {
		out = append(out, NewResource(spec))
	}
	return out
}

func (p *homerunProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	out := make([]func() datasource.DataSource, 0, len(p.spec.DataSources))
	for _, spec := range p.spec.DataSources {
		out = append(out, NewDataSource(spec, p.spec.Resources))
	}
	return out
}

func firstSet(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
