import { Construct } from 'constructs';
import {
    aws_route53 as route53,
    aws_ec2 as ec2,
    Fn,
    Stack,
} from 'aws-cdk-lib';
import { CdkStackProps } from './main-stack';

export class ImportValues extends Construct implements CdkStackProps {
    public hostedZone: route53.IHostedZone;
    public igwId: string;
    public vpc: ec2.IVpc;
    public otherSecurityGroups: ec2.ISecurityGroup[] = [];
    public clusterSecurityGroup: ec2.ISecurityGroup;

    public maxAzs: number;
    public appId: number;
    public instanceCount: number;

    constructor(scope: Construct, props: CdkStackProps) {
        super(scope, 'ImportValues')

        this.maxAzs = props.maxAzs;
        this.appId = props.appId;
        this.instanceCount = props.instanceCount;

        this.vpc = ec2.Vpc.fromVpcAttributes(this, 'CoreVpc', {
            vpcId: Fn.importValue('Core-Vpc'),
            availabilityZones: Stack.of(this).availabilityZones,
        });

        this.igwId = Fn.importValue('Core-InternetGateway');

        this.otherSecurityGroups.push(
            ec2.SecurityGroup.fromSecurityGroupId(this, 'MysqlSecurityGroup', Fn.importValue('Core-MySqlSecurityGroup')));
        this.clusterSecurityGroup =
            ec2.SecurityGroup.fromSecurityGroupId(this, 'EcsSecurityGroup', Fn.importValue('Core-ClusterSecurityGroup'));
        this.otherSecurityGroups.push(this.clusterSecurityGroup);
    }
}
