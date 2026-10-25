package dockerapi

import (
	"context"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/moby/moby/api/types/swarm"
	"github.com/moby/moby/client"
)

// SwarmService is the part of a swarm service's inspect a deploy reads.
type SwarmService struct {
	ID   string `json:"ID"`
	Spec struct {
		Labels       map[string]string `json:"Labels"`
		Name         string            `json:"Name"`
		TaskTemplate struct {
			ForceUpdate int `json:"ForceUpdate"`
		} `json:"TaskTemplate"`
	} `json:"Spec"`
	UpdateStatus *struct {
		Message   string `json:"Message"`
		StartedAt string `json:"StartedAt"`
		State     string `json:"State"`
	} `json:"UpdateStatus"`
	Version struct {
		Index int64 `json:"Index"`
	} `json:"Version"`
}

// SwarmTask is one task of a swarm service: which node runs it, which slot it
// fills, what the daemon wants it to be doing and what it's actually doing.
type SwarmTask struct {
	CreatedAt    string `json:"CreatedAt"`
	DesiredState string `json:"DesiredState"`
	ID           string `json:"ID"`
	NodeID       string `json:"NodeID"`
	ServiceID    string `json:"ServiceID"`
	Slot         int    `json:"Slot"`
	Status       struct {
		ContainerStatus *struct {
			ContainerID string `json:"ContainerID"`
			ExitCode    int    `json:"ExitCode"`
		} `json:"ContainerStatus"`
		Err       string `json:"Err"`
		Message   string `json:"Message"`
		State     string `json:"State"`
		Timestamp string `json:"Timestamp"`
	} `json:"Status"`
	UpdatedAt string `json:"UpdatedAt"`
}

// SwarmNode is one node of the swarm, reduced to what the replicas panel and
// the Remote Hosts page show about it.
type SwarmNode struct {
	Description struct {
		Engine struct {
			EngineVersion string `json:"EngineVersion"`
		} `json:"Engine"`
		Hostname string `json:"Hostname"`
		Platform struct {
			Architecture string `json:"Architecture"`
			OS           string `json:"OS"`
		} `json:"Platform"`
		Resources struct {
			MemoryBytes int64 `json:"MemoryBytes"`
			NanoCPUs    int64 `json:"NanoCPUs"`
		} `json:"Resources"`
	} `json:"Description"`
	ID            string `json:"ID"`
	ManagerStatus *struct {
		Leader bool `json:"Leader"`
	} `json:"ManagerStatus,omitempty"`
	Spec struct {
		Availability string            `json:"Availability"`
		Labels       map[string]string `json:"Labels"`
		Role         string            `json:"Role"`
	} `json:"Spec"`
	Status struct {
		Addr  string `json:"Addr"`
		State string `json:"State"`
	} `json:"Status"`
}

// SwarmJoin is what a new worker node needs to join this swarm.
type SwarmJoin struct {
	ManagerAddress string `json:"managerAddress"`
	Token          string `json:"token"`
}

// timestamp renders a daemon time the way the Engine's own JSON does, or ""
// for an unset one.
func timestamp(at time.Time) string {
	if at.IsZero() {
		return ""
	}
	return at.Format(time.RFC3339Nano)
}

// projectService reduces a typed swarm service to a SwarmService.
func projectService(full swarm.Service) SwarmService {
	var service SwarmService
	service.ID = full.ID
	service.Spec.Labels = full.Spec.Labels
	service.Spec.Name = full.Spec.Name
	service.Spec.TaskTemplate.ForceUpdate = toInt(full.Spec.TaskTemplate.ForceUpdate)
	service.Version.Index = toInt64(full.Version.Index)
	if status := full.UpdateStatus; status != nil {
		service.UpdateStatus = &struct {
			Message   string `json:"Message"`
			StartedAt string `json:"StartedAt"`
			State     string `json:"State"`
		}{Message: status.Message, State: string(status.State)}
		if status.StartedAt != nil {
			service.UpdateStatus.StartedAt = timestamp(*status.StartedAt)
		}
	}
	return service
}

// projectTask reduces a typed swarm task to a SwarmTask.
func projectTask(full swarm.Task) SwarmTask {
	task := SwarmTask{
		CreatedAt:    timestamp(full.CreatedAt),
		DesiredState: string(full.DesiredState),
		ID:           full.ID,
		NodeID:       full.NodeID,
		ServiceID:    full.ServiceID,
		Slot:         full.Slot,
		UpdatedAt:    timestamp(full.UpdatedAt),
	}
	task.Status.Err = full.Status.Err
	task.Status.Message = full.Status.Message
	task.Status.State = string(full.Status.State)
	task.Status.Timestamp = timestamp(full.Status.Timestamp)
	if status := full.Status.ContainerStatus; status != nil {
		task.Status.ContainerStatus = &struct {
			ContainerID string `json:"ContainerID"`
			ExitCode    int    `json:"ExitCode"`
		}{ContainerID: status.ContainerID, ExitCode: status.ExitCode}
	}
	return task
}

// projectNode reduces a typed swarm node to a SwarmNode.
func projectNode(full swarm.Node) SwarmNode {
	var node SwarmNode
	node.ID = full.ID
	node.Description.Engine.EngineVersion = full.Description.Engine.EngineVersion
	node.Description.Hostname = full.Description.Hostname
	node.Description.Platform.Architecture = full.Description.Platform.Architecture
	node.Description.Platform.OS = full.Description.Platform.OS
	node.Description.Resources.MemoryBytes = full.Description.Resources.MemoryBytes
	node.Description.Resources.NanoCPUs = full.Description.Resources.NanoCPUs
	if full.ManagerStatus != nil {
		node.ManagerStatus = &struct {
			Leader bool `json:"Leader"`
		}{Leader: full.ManagerStatus.Leader}
	}
	node.Spec.Availability = string(full.Spec.Availability)
	node.Spec.Labels = full.Spec.Labels
	node.Spec.Role = string(full.Spec.Role)
	node.Status.Addr = full.Status.Addr
	node.Status.State = string(full.Status.State)
	return node
}

// listServices is the daemon's typed service list, with each service's
// running and desired task counts when status is set.
func (c *Client) listServices(ctx context.Context, filters client.Filters, status bool) ([]swarm.Service, error) {
	listed, err := control(ctx, ControlTimeout, "list swarm services", "", func(ctx context.Context) (client.ServiceListResult, error) {
		return c.api.ServiceList(ctx, client.ServiceListOptions{Filters: filters, Status: status})
	})
	return listed.Items, err
}

// SwarmServicesByLabel lists the swarm services carrying label ("key=value").
func (c *Client) SwarmServicesByLabel(ctx context.Context, label string) ([]SwarmService, error) {
	listed, err := c.listServices(ctx, labelFilter(label), false)
	if err != nil {
		return nil, err
	}
	services := make([]SwarmService, 0, len(listed))
	for _, service := range listed {
		services = append(services, projectService(service))
	}
	return services, nil
}

// inspectService is the daemon's full typed inspect of a swarm service.
func (c *Client) inspectService(ctx context.Context, id string) (swarm.Service, error) {
	inspected, err := control(ctx, ControlTimeout, "inspect swarm service "+id, "", func(ctx context.Context) (client.ServiceInspectResult, error) {
		return c.api.ServiceInspect(ctx, id, client.ServiceInspectOptions{})
	})
	return inspected.Service, err
}

// InspectSwarmService inspects one swarm service.
func (c *Client) InspectSwarmService(ctx context.Context, id string) (*SwarmService, error) {
	full, err := c.inspectService(ctx, id)
	if err != nil {
		return nil, err
	}
	service := projectService(full)
	return &service, nil
}

// CreateSwarmService creates a swarm service and returns its id. auth, when
// given, is stored with the service so every node, not just this manager, can
// pull a private image (the CLI's --with-registry-auth).
func (c *Client) CreateSwarmService(ctx context.Context, spec swarm.ServiceSpec, auth *AuthConfig) (string, error) {
	encoded, err := auth.encode()
	if err != nil {
		return "", err
	}
	created, err := control(ctx, ControlTimeout, "create swarm service "+spec.Name, "", func(ctx context.Context) (client.ServiceCreateResult, error) {
		return c.api.ServiceCreate(ctx, client.ServiceCreateOptions{EncodedRegistryAuth: encoded, Spec: spec})
	})
	return created.ID, err
}

// UpdateSwarmService replaces a swarm service's spec at version, with auth
// handed to every node that pulls its image, as for CreateSwarmService.
func (c *Client) UpdateSwarmService(ctx context.Context, id string, version int64, spec swarm.ServiceSpec, auth *AuthConfig) error {
	encoded, err := auth.encode()
	if err != nil {
		return err
	}
	return discard(control(ctx, ControlTimeout, "update swarm service "+id, "", func(ctx context.Context) (client.ServiceUpdateResult, error) {
		return c.api.ServiceUpdate(ctx, id, client.ServiceUpdateOptions{
			EncodedRegistryAuth: encoded,
			Spec:                spec,
			Version:             swarm.Version{Index: uint64(max(version, 0))},
		})
	}))
}

// updateService reads a service's current spec, lets change edit it and writes
// it back at the version it was read at.
func (c *Client) updateService(ctx context.Context, id string, change func(*swarm.ServiceSpec)) error {
	full, err := c.inspectService(ctx, id)
	if err != nil {
		return err
	}
	spec := full.Spec
	change(&spec)
	return discard(control(ctx, ControlTimeout, "update swarm service "+id, "", func(ctx context.Context) (client.ServiceUpdateResult, error) {
		return c.api.ServiceUpdate(ctx, id, client.ServiceUpdateOptions{Spec: spec, Version: full.Version})
	}))
}

// listNodes is the daemon's typed node list.
func (c *Client) listNodes(ctx context.Context) ([]swarm.Node, error) {
	listed, err := control(ctx, ControlTimeout, "list swarm nodes", "", func(ctx context.Context) (client.NodeListResult, error) {
		return c.api.NodeList(ctx, client.NodeListOptions{})
	})
	return listed.Items, err
}

// CountSwarmNodes is how many nodes the swarm has.
func (c *Client) CountSwarmNodes(ctx context.Context) (int, error) {
	nodes, err := c.listNodes(ctx)
	return len(nodes), err
}

// ListSwarmNodes lists the swarm's nodes.
func (c *Client) ListSwarmNodes(ctx context.Context) ([]SwarmNode, error) {
	listed, err := c.listNodes(ctx)
	if err != nil {
		return nil, err
	}
	nodes := make([]SwarmNode, 0, len(listed))
	for _, node := range listed {
		nodes = append(nodes, projectNode(node))
	}
	return nodes, nil
}

// SwarmJoinInfo reads the worker join token and the address this manager
// listens on for joins.
func (c *Client) SwarmJoinInfo(ctx context.Context) (*SwarmJoin, error) {
	inspected, err := control(ctx, ControlTimeout, "inspect swarm", "", func(ctx context.Context) (client.SwarmInspectResult, error) {
		return c.api.SwarmInspect(ctx, client.SwarmInspectOptions{})
	})
	if err != nil {
		return nil, err
	}
	info, err := c.info(ctx)
	if err != nil {
		return nil, err
	}
	address := info.Swarm.NodeAddr + ":2377"
	for _, manager := range info.Swarm.RemoteManagers {
		if manager.NodeID == info.Swarm.NodeID {
			address = manager.Addr
		}
	}
	return &SwarmJoin{ManagerAddress: address, Token: inspected.Swarm.JoinTokens.Worker}, nil
}

// RemoveSwarmNode forcibly removes a node from the swarm. The node itself
// still believes it's joined until someone runs `docker swarm leave` on it.
func (c *Client) RemoveSwarmNode(ctx context.Context, id string) error {
	return discard(control(ctx, ControlTimeout, "remove swarm node "+id, "", func(ctx context.Context) (client.NodeRemoveResult, error) {
		return c.api.NodeRemove(ctx, id, client.NodeRemoveOptions{Force: true})
	}))
}

// SetSwarmNodeLabels replaces a node's labels, the ones placement constraints
// and preferences read as `node.labels.<key>`, keeping the rest of its spec.
func (c *Client) SetSwarmNodeLabels(ctx context.Context, id string, labels map[string]string) error {
	inspected, err := control(ctx, ControlTimeout, "inspect swarm node "+id, "", func(ctx context.Context) (client.NodeInspectResult, error) {
		return c.api.NodeInspect(ctx, id, client.NodeInspectOptions{})
	})
	if err != nil {
		return err
	}
	if labels == nil {
		labels = map[string]string{}
	}
	spec := inspected.Node.Spec
	spec.Labels = labels
	return discard(control(ctx, ControlTimeout, "update swarm node "+id, "", func(ctx context.Context) (client.NodeUpdateResult, error) {
		return c.api.NodeUpdate(ctx, id, client.NodeUpdateOptions{Spec: spec, Version: inspected.Node.Version})
	}))
}

// InitSwarm turns this daemon into a single-node swarm manager. A daemon
// already in a swarm answers 503, which is reported as-is: the caller checks
// SystemInfo first rather than relying on this being idempotent.
func (c *Client) InitSwarm(ctx context.Context, listenAddr string) error {
	if listenAddr == "" {
		listenAddr = "0.0.0.0:2377"
	}
	return discard(control(ctx, 2*ControlTimeout, "init swarm", "", func(ctx context.Context) (client.SwarmInitResult, error) {
		return c.api.SwarmInit(ctx, client.SwarmInitOptions{ListenAddr: listenAddr})
	}))
}

// ListSwarmTasks lists a service's tasks, restricted to the ones the daemon
// wants running when runningOnly is set (the rest are the corpses of previous
// generations, which swarm keeps around).
func (c *Client) ListSwarmTasks(ctx context.Context, serviceID string, runningOnly bool) ([]SwarmTask, error) {
	filters := client.Filters{}.Add("service", serviceID)
	if runningOnly {
		filters.Add("desired-state", "running")
	}
	listed, err := control(ctx, ControlTimeout, "list tasks of "+serviceID, "", func(ctx context.Context) (client.TaskListResult, error) {
		return c.api.TaskList(ctx, client.TaskListOptions{Filters: filters})
	})
	if err != nil {
		return nil, err
	}
	tasks := make([]SwarmTask, 0, len(listed.Items))
	for _, task := range listed.Items {
		tasks = append(tasks, projectTask(task))
	}
	return tasks, nil
}

// RemoveSwarmService removes a swarm service. One already gone isn't an error.
func (c *Client) RemoveSwarmService(ctx context.Context, id string) error {
	err := discard(control(ctx, ControlTimeout, "remove swarm service "+id, "", func(ctx context.Context) (client.ServiceRemoveResult, error) {
		return c.api.ServiceRemove(ctx, id, client.ServiceRemoveOptions{})
	}))
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// RestartSwarmService rolls a service's tasks without changing its spec, by
// bumping the one field swarm treats as "this task template is new".
func (c *Client) RestartSwarmService(ctx context.Context, id string) error {
	return c.updateService(ctx, id, func(spec *swarm.ServiceSpec) {
		spec.TaskTemplate.ForceUpdate++
	})
}

// ScaleSwarmService sets a replicated swarm service's replica count, keeping
// the rest of its spec: swarm's own "stop" (0) and "start" (its usual count).
func (c *Client) ScaleSwarmService(ctx context.Context, id string, replicas int) error {
	count := uint64(max(replicas, 0))
	return c.updateService(ctx, id, func(spec *swarm.ServiceSpec) {
		spec.Mode = swarm.ServiceMode{Replicated: &swarm.ReplicatedService{Replicas: &count}}
	})
}

// logsTail is a logs call's tail option: every line for 0 or less.
func logsTail(tail int) string {
	if tail > 0 {
		return strconv.Itoa(tail)
	}
	return "all"
}

// SwarmServiceLogs opens a swarm service's aggregated task logs, following
// them when follow is set. The caller closes the stream.
func (c *Client) SwarmServiceLogs(ctx context.Context, id string, tail int, follow bool) (io.ReadCloser, error) {
	return streaming(ctx, "logs of swarm service "+id, "", c.daemonAnswers, func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ServiceLogs(ctx, id, client.ServiceLogsOptions{
			Follow:     follow,
			ShowStderr: true,
			ShowStdout: true,
			Tail:       logsTail(tail),
		})
	})
}

// SwarmTaskLogs opens one swarm task's logs with a timestamp on every line,
// following them when follow is set. The caller closes the stream.
func (c *Client) SwarmTaskLogs(ctx context.Context, id string, tail int, follow bool) (io.ReadCloser, error) {
	return streaming(ctx, "logs of swarm task "+id, "", c.daemonAnswers, func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.TaskLogs(ctx, id, client.TaskLogsOptions{
			Follow:     follow,
			ShowStderr: true,
			ShowStdout: true,
			Tail:       logsTail(tail),
			Timestamps: true,
		})
	})
}

// CountRunningSwarmTasks is how many of a swarm service's tasks are running,
// across every node. Only the service list reports task counts (an inspect
// never does), so the list is filtered down to this one service.
func (c *Client) CountRunningSwarmTasks(ctx context.Context, id string) (int, error) {
	listed, err := c.listServices(ctx, client.Filters{}.Add("id", id), true)
	if err != nil {
		return 0, err
	}
	for _, service := range listed {
		if service.ID != id {
			continue
		}
		if service.ServiceStatus == nil {
			return 0, nil
		}
		return toInt(service.ServiceStatus.RunningTasks), nil
	}
	return 0, ErrNotFound
}

// SwarmServiceReplicas is a replicated service's configured replica count.
func (c *Client) SwarmServiceReplicas(ctx context.Context, id string) (int, error) {
	full, err := c.inspectService(ctx, id)
	if err != nil {
		return 0, err
	}
	replicated := full.Spec.Mode.Replicated
	if replicated == nil || replicated.Replicas == nil {
		return 0, nil
	}
	return toInt(*replicated.Replicas), nil
}
