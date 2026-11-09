package cli

var mailResources = []Resource{
	{
		Columns: []string{"id", "name", "dkimSelector", "createdAt"},
		Group:   "mail domains", ID: "id", Noun: "mail domain", Path: "/mail/domains",
		Verbs: []string{"list", "get", "create", "delete"},
	},
	{
		Columns: []string{"id", "address", "kind", "enabled", "quotaMb", "ownerId"},
		Group:   "mail mailboxes", ID: "id", Noun: "mailbox", Path: "/mail/mailboxes", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "address", "destinations", "enabled"},
		Group:   "mail aliases", ID: "id", Noun: "mail alias", Path: "/mail/aliases", Verbs: allVerbs,
	},
}
