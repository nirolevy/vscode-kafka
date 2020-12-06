import { dump } from "js-yaml";
import * as vscode from "vscode";

import { Topic, ClientAccessor, Client } from "../client";
import { KafkaExplorer, TopicItem } from "../explorer";
import { OutputChannelProvider } from "../providers";
import { pickTopicFromSelectedCluster } from "./common";

const AUTO_CREATE_TOPIC_KEY = 'auto.create.topics.enable';

export class CreateTopicCommandHandler {
    constructor(private clientAccessor: ClientAccessor, private explorer: KafkaExplorer) {
    }

    private validatePositiveNumber(value?: string): string | undefined {
        if (!value) {
            return "Must be a positive number";
        }

        const valueAsNumber = parseInt(value, 10);

        if (isNaN(valueAsNumber) || valueAsNumber < 1) {
            return "Must be a positive number";
        }
    }

    async execute(clusterId?: string): Promise<void> {
        if (!clusterId) {
            return;
        }

        const topic = await vscode.window.showInputBox({ placeHolder: "Topic name", ignoreFocusOut: true });

        if (!topic) {
            return;
        }

        const partitions = await vscode.window.showInputBox({
            placeHolder: "Number of partitions",
            validateInput: this.validatePositiveNumber,
            ignoreFocusOut: true
        });

        if (!partitions) {
            return;
        }

        const replicationFactor = await vscode.window.showInputBox({
            placeHolder: "Replication Factor",
            validateInput: this.validatePositiveNumber,
            ignoreFocusOut: true
        });

        if (!replicationFactor) {
            return;
        }

        try {
            const client = this.clientAccessor.get(clusterId);
            const result = await client.createTopic({
                topic,
                partitions: parseInt(partitions, 10),
                replicationFactor: parseInt(replicationFactor, 10),
            });

            if (result.length > 0) {
                vscode.window.showErrorMessage(result[0].error);
            } else {
                this.explorer.refresh();
                vscode.window.showInformationMessage(`Topic '${topic}' created successfully`);
            }
        } catch (error) {
            if (error.message) {
                vscode.window.showErrorMessage(error.message);
            } else {
                vscode.window.showErrorMessage(error);
            }
        }
    }
}

export class DumpTopicMetadataCommandHandler {
    constructor(private clientAccessor: ClientAccessor, private outputChannelProvider: OutputChannelProvider) {
    }

    async execute(topic?: TopicItem): Promise<void> {
        let client: Client | undefined;

        if (topic) {
            client = this.clientAccessor.get(topic.clusterId);
        } else {
            client = this.clientAccessor.getSelectedClusterClient();
        }

        if (!client) {
            vscode.window.showInformationMessage("No cluster selected");
            return;
        }

        const topicToDump: Topic | undefined = topic ? topic.topic : await pickTopicFromSelectedCluster(this.clientAccessor);

        if (!topicToDump) {
            return;
        }

        const configs = await client.getTopicConfigs(topicToDump.id);
        const data = {
            ...topicToDump,
            configs,
        };

        const channel = this.outputChannelProvider.getChannel("Topic Metadata");
        channel.clear();
        channel.append(dump(data));
        channel.show();
    }
}

export class DeleteTopicCommandHandler {
    constructor(private clientAccessor: ClientAccessor, private explorer: KafkaExplorer) {
    }

    async execute(topic?: TopicItem): Promise<void> {
        let client: Client | undefined;

        if (topic) {
            client = this.clientAccessor.get(topic.clusterId);
        } else {
            client = this.clientAccessor.getSelectedClusterClient();
        }

        if (!client) {
            vscode.window.showInformationMessage("No cluster selected");
            return;
        }

        //TODO implement multiple topic deletion
        const topicToDelete: Topic | undefined = topic ? topic.topic : await pickTopicFromSelectedCluster(this.clientAccessor);

        if (!topicToDelete) {
            return;
        }

        try {
            const brokers = await client?.getBrokers();
            let autoCreateTopicsEnabled = false;

            if (brokers) {
                for (let i = 0; i < brokers.length && !autoCreateTopicsEnabled; i++) {
                    const configs = await client?.getBrokerConfigs(brokers[i].id);
                    const config = configs?.find(ce => ce.configName === AUTO_CREATE_TOPIC_KEY);
                    if (config) {
                        autoCreateTopicsEnabled = config.configValue == 'true'
                    }
                }
            }

            let warning = `Are you sure you want to delete topic '${topicToDelete.id}'?`;
            if (autoCreateTopicsEnabled) {
                warning += ` The cluster is configured with '${AUTO_CREATE_TOPIC_KEY}=true', so the topic might be recreated automatically.`;
            }
            const deleteConfirmation = await vscode.window.showWarningMessage(warning, 'Cancel', 'Delete');
            if (deleteConfirmation !== 'Delete') {
                return;
            }

            await client.deleteTopic({topics:[ topicToDelete.id ]});
            this.explorer.refresh();
            vscode.window.showInformationMessage(`Topic '${topicToDelete.id}' deleted successfully`);
        } catch (error) {
            if (error.message) {
                vscode.window.showErrorMessage(error.message);
            } else {
                vscode.window.showErrorMessage(error);
            }
        }
    }
}