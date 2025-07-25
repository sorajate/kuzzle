import { omit } from "lodash";
import should from "should/as-function";

import { PassThrough } from "stream";
import YAML from "yaml";
import functionalFixtures from "../../features/fixtures/imports.json";
import {
  Backend,
  EventGenericDocumentBeforeUpdate,
  HttpStream,
  KDocument,
  KDocumentContent,
  KuzzleRequest,
  Mutex,
} from "../../index";
import { HttpMessage } from "../../lib/types/HttpMessage";
import { EventGenericDocumentInjectMetadata } from "../../lib/types/events/EventGenericDocument";
import { FunctionalTestsController } from "./functional-tests-controller";

const app = new Backend("functional-tests-app");

async function loadAdditionalPlugins() {
  const additionalPluginsIndex = process.argv.indexOf("--enable-plugins");
  const additionalPlugins =
    additionalPluginsIndex > -1
      ? process.argv[additionalPluginsIndex + 1].split(",")
      : [];

  for (const name of additionalPlugins) {
    const path = `../../plugins/available/${name}`;
    const { default: Plugin } = await import(path);

    let manifest = null;

    try {
      manifest = require(`${path}/manifest.json`);
    } catch (e) {
      // do nothing
    }

    const options =
      manifest !== null ? { manifest, name: manifest.name } : null;

    app.plugin.use(new Plugin(), options);
  }
}

if (!process.env.CI) {
  // Easier debug
  app.hook.register("request:onError", async (request: KuzzleRequest) => {
    app.log.error(request.error);
  });

  app.hook.register("hook:onError", async (request: KuzzleRequest) => {
    app.log.error(request.error);
  });
}

app.pipe.register<EventGenericDocumentInjectMetadata>(
  "generic:document:injectMetadata",
  async (event) => {
    const metadata = {
      ...event.metadata,
    };

    if (
      event.request.getBody().addCustomMetadata ||
      (event.request.getController() === "document" &&
        event.request.getAction() === "upsert" &&
        event.request.getBodyObject("changes", {}).addCustomMetadata)
    ) {
      metadata.customMetadata = "customized";
    }

    return {
      request: event.request,
      metadata: metadata,
      defaultMetadata: event.defaultMetadata,
    };
  },
);

// Controller class usage
app.controller.use(new FunctionalTestsController(app));

// Pipe management
app.controller.register("pipes", {
  actions: {
    deactivateAll: {
      handler: async () => {
        const names: any = await app.sdk.ms.keys("app:pipes:*");

        for (const name of names) {
          const pipe = JSON.parse(await app.sdk.ms.get(name));
          pipe.state = "off";
          await app.sdk.ms.set(name, JSON.stringify(pipe));
        }

        return null;
      },
    },
    manage: {
      handler: async (request: KuzzleRequest) => {
        const payload = request.input.body;
        const state = request.input.args.state;
        const event = request.input.args.event;

        await app.sdk.ms.set(
          `app:pipes:${event}`,
          JSON.stringify({
            payload,
            state,
          }),
        );

        return null;
      },
    },
  },
});

app.controller.register("customSubscription", {
  actions: {
    subscribe: {
      handler: async (request: KuzzleRequest) => {
        const { roomId, channel } = await app.subscription.add(
          request.context.connection,
          "lamaral",
          "windsurf",
          {},
        );

        return { roomId, channel };
      },
    },
    unsubscribe: {
      handler: async (request: KuzzleRequest) => {
        await app.subscription.remove(
          request.context.connection,
          request.input.args.roomId,
        );
      },
    },
  },
});

/* Actual code for tests start here */

/**
 * This function is never call but simply ensure the correctness of types definition
 */
function ensureEventDefinitionTypes() {
  type EventFoobar = {
    name: "event:foobar";

    args: [number, string];
  };

  app.pipe.register<EventFoobar>(
    "event:foobar",
    async (age: number, name: string) => {
      return age;
    },
  );

  app.hook.register<EventFoobar>(
    "event:foobar",
    (age: number, name: string) => {},
  );

  app.cluster.on<EventFoobar>(
    "event:foobar",
    async (age: number, name: string) => {},
  );

  app.cluster.broadcast<EventFoobar>("event:foobar", 30);

  const promise: Promise<number> = app.trigger<EventFoobar>(
    "event:foobar",
    30,
    "Tuan",
  );

  interface PersonContent extends KDocumentContent {
    name: string;
  }

  app.pipe.register<EventGenericDocumentBeforeUpdate<PersonContent>>(
    "generic:document:beforeUpdate",
    async (documents: KDocument<PersonContent>[], request: KuzzleRequest) => {
      return documents;
    },
  );
}

/**
 * This function is never call but simply ensure the correctness of types definition
 */
async function ensureQueryDefinitionTypes() {
  type Req = {
    action: "create";
    body: {
      name: string;
    };
    controller: "engine";
    engineId: string;
  };

  type Res = {
    age: number;
  };

  const response = await app.sdk.query<Req, Res>({
    action: "create",
    body: {
      name: "test",
    },
    controller: "engine",
    engineId: "test",
  });

  const age = response.result.age;
}

// Pipe registration
app.pipe.register("server:afterNow", async (request) => {
  const pipe = JSON.parse(await app.sdk.ms.get("app:pipes:server:afterNow"));

  if (pipe && pipe.state !== "off") {
    request.response.result = { coworking: "Spiced" };
  }

  return request;
});

app.pipe.register(
  "protocol:http:beforeParsingPayload",
  async ({ message, payload }: { message: HttpMessage; payload: Buffer }) => {
    if (message.headers["content-type"] !== "application/x-yaml") {
      return { payload };
    }

    const convertedPayload = YAML.parse(payload.toString());

    return { payload: JSON.stringify(convertedPayload) };
  },
);

// Hook registration and embedded SDK realtime publish
app.hook.register("custom:event", async (name) => {
  await app.sdk.realtime.publish("app-functional-test", "hooks", {
    event: "custom:event",
    name,
  });
});

let syncedHello = "World";
let dynamicPipeId;

app.openApi.definition.components = {};
app.openApi.definition.components.LogisticObjects = {
  Item: {
    properties: {
      age: { type: "integer" },
      name: { type: "string" },
    },
    type: "object",
  },
};

app.controller.register("openapi-test", {
  actions: {
    hello: {
      handler: async () => ({ hello: "world" }),
      http: [
        {
          openapi: {
            description: "Creates a new Logistic Object",
            parameters: [
              {
                description: "Content of the Logistic Object",
                in: "body",
                required: true,
                schema: {
                  $ref: "#/components/LogisticObjects/Item",
                },
              },
            ],
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "string",
                    },
                  },
                },
                description: "Custom greeting",
              },
            },
          },
          path: "/openapi-test/:company/:objectType/:_id",
          verb: "post",
        },
      ],
    },
  },
});

app.controller.register("stream-test", {
  actions: {
    downloadChunked: {
      handler: async () => {
        const stream = new PassThrough();
        stream.write("Hello");
        stream.write("World");
        stream.end();

        return new HttpStream(stream);
      },
      http: [
        {
          verb: "get",
          path: "/stream-test/download-chunked",
        },
      ],
    },
    downloadFixed: {
      handler: async () => {
        const stream = new PassThrough();
        stream.write("Hello");
        stream.write("World");
        stream.end();

        return new HttpStream(stream, { totalBytes: 10 });
      },
      http: [
        {
          verb: "get",
          path: "/stream-test/download-fixed",
        },
      ],
    },
  },
});

app.errors.register("app", "api", "custom", {
  class: "BadRequestError",
  description: "This is a custom error from API subdomain",
  message: "Custom %s error",
});

app.hook.register(
  "generic:document:afterUpdate",
  async (documents, request: KuzzleRequest) => {
    await app.sdk.document.createOrReplace(
      request.getIndex(),
      request.getCollection(),
      "generic:document:afterUpdate",
      {},
    );
  },
);

app.controller.register("tests", {
  actions: {
    clearOutage: {
      handler: async () => {
        global.kuzzle.funnel.overloaded = false;
        global.kuzzle.state = 2;
      },
      http: [{ path: "/tests/clear-outage", verb: "get" }],
    },
    customError: {
      handler: async () => {
        throw app.errors.get("app", "api", "custom", "Tbilisi");
      },
    },

    getSyncedHello: {
      handler: async () => `Hello, ${syncedHello}`,
      http: [{ path: "/hello", verb: "get" }],
    },

    mutex: {
      handler: async () => {
        const ttl = 5000;
        const mutex = new Mutex("functionalTestMutexHandler", {
          timeout: 0,
          ttl,
        });

        const locked = await mutex.lock();

        return { locked };
      },
      http: [{ path: "/tests/mutex/acquire", verb: "get" }],
    },

    "register-pipe": {
      handler: async () => {
        dynamicPipeId = app.pipe.register(
          "server:afterNow",
          async (request) => {
            request.result.name = "Ugo";

            return request;
          },
          { dynamic: true },
        );

        return dynamicPipeId;
      },
    },

    sayHello: {
      handler: async (request: KuzzleRequest) => {
        return { greeting: `Hello, ${request.input.args.name}` };
      },
      http: [{ path: "/hello/:name", verb: "post" }],
    },

    sendBodyHeaders: {
      handler: async (request: KuzzleRequest) => {
        request.response.configure({
          headers: {
            alpha: "beta",
            foo: "bar",
            "set-cookie": "foo=bar",
          },
        });
      },
      http: [{ path: "/tests/body/sendeaders", verb: "get" }],
    },

    simulateOutage: {
      handler: async (request: KuzzleRequest) => {
        const outageType = request.getString("type");

        switch (outageType) {
          case "overload":
            global.kuzzle.funnel.overloaded = true;
            break;
          case "nodeNotStarted":
            global.kuzzle.state = 1;
            break;
          default:
            break;
        }
      },
      http: [{ path: "/tests/simulate-outage", verb: "get" }],
    },

    // Access storage client
    storageClient: {
      handler: async (request: KuzzleRequest) => {
        const client = new app.storage.StorageClient();
        const esRequest = {
          body: request.input.body,
          id: request.input.args._id,
          index: request.input.args.index,
        };

        const response = await client.index(esRequest);
        const response2 = await app.storage.storageClient.index(esRequest);

        if (response.body && response2.body) {
          // ES7
          should(omit(response.body, ["_version", "result", "_seq_no"])).match(
            omit(response2.body, ["_version", "result", "_seq_no"]),
          );
          return response.body;
        }

        // ES8
        should(omit(response, ["_version", "result", "_seq_no"])).match(
          omit(response2, ["_version", "result", "_seq_no"]),
        );
        return response;
      },
      http: [{ path: "/tests/storage-client/:index", verb: "post" }],
    },

    syncHello: {
      handler: async (request: KuzzleRequest) => {
        syncedHello = request.input.args.name;
        await app.cluster.broadcast("sync:hello", { name: syncedHello });
        return "OK";
      },
      http: [{ path: "/syncHello/:name", verb: "put" }],
    },

    triggerEvent: {
      handler: async (request: KuzzleRequest) => {
        await app.trigger("custom:event", request.input.args.name);

        return { payload: request.input.args.name, trigger: "custom:event" };
      },
    },

    "unregister-pipe": {
      handler: async () => {
        app.pipe.unregister(dynamicPipeId);
      },
    },

    vault: {
      handler: async () => app.vault.secrets,
    },
  },
});

let vaultfile = "features/fixtures/secrets.enc.json";
if (process.env.SECRETS_FILE_PREFIX) {
  vaultfile = process.env.SECRETS_FILE_PREFIX + vaultfile;
}
app.vault.file = vaultfile;
app.vault.key = "secret-password";

// Ensure imports before startup are working
app.import.mappings(functionalFixtures.mappings);
app.import.profiles(functionalFixtures.profiles);
app.import.roles(functionalFixtures.roles);
app.import.userMappings(functionalFixtures.userMappings);
app.import.users(functionalFixtures.users, { onExistingUsers: "overwrite" });

loadAdditionalPlugins()
  .then(() => app.start())
  .then(async () => {
    // post-start methods here

    // Cluster synchronization
    await app.cluster.on("sync:hello", (payload) => {
      syncedHello = payload.name;
    });
  })
  .catch((error) => {
    app.log.error(error.message);
    process.exit(1);
  });
