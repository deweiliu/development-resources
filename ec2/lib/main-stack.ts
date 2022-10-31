import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  CfnOutput,
  aws_rds as rds,
  RemovalPolicy,
    Fn,
    Duration,
  aws_iam as iam,
} from 'aws-cdk-lib';
import amis from './AMIs.json'
import { Construct } from 'constructs';
import { ImportValues } from './import-values';

export interface CdkStackProps extends StackProps {
  appId: number;
  maxAzs: number;
  instanceCount: number;
}
export class Ec2Stack extends Stack {
  constructor(scope: Construct, id: string, props: CdkStackProps) {
    super(scope, id, props);

    const get = new ImportValues(this, props);

    const ecsKeyPair=new ec2.CfnKeyPair(this,'ECSKeyPair',{
      keyName:'test-instance',
      keyType:'rsa',
  });

    const subnets: ec2.ISubnet[] = [];

    [...Array(props.maxAzs).keys()].forEach(azIndex => {
      const subnet = new ec2.PublicSubnet(this, `Subnet` + azIndex, {
        vpcId: get.vpc.vpcId,
        availabilityZone: Stack.of(this).availabilityZones[azIndex],
        cidrBlock: `10.0.${get.appId}.${(azIndex + 0) * 16}/28`,
        mapPublicIpOnLaunch: true,
      });
      subnet.routeTable.routeTableId
      new ec2.CfnRoute(this, 'PublicRouting' + azIndex, {
        destinationCidrBlock: '0.0.0.0/0',
        routeTableId: subnet.routeTable.routeTableId,
        gatewayId: get.igwId,
      });
      subnets.push(subnet);
    });
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'CoreVpc', {
      vpcId: get.vpc.vpcId,
      availabilityZones: get.vpc.availabilityZones,
      publicSubnetIds: subnets.map(subnet => subnet.subnetId),
      publicSubnetRouteTableIds: subnets.map(subnet => subnet.routeTable.routeTableId),
    });
    const clusterSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ClusterSecurityGroup', Fn.importValue('Core-ClusterSecurityGroup'));

    clusterSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(22));
    clusterSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(3306));
    clusterSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(5432));

    get.clusterSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(22));
    get.otherSecurityGroups.forEach(otherSg => {
      otherSg.connections.allowFrom(clusterSecurityGroup, ec2.Port.allTcp(), 'Allow from Dev EC2');
    });

    const image='ec2-user';
    if (process.env['EC2'] === 'true') {
      [...Array(get.instanceCount).keys()].forEach(instanceId => {
        const instance = new ec2.Instance(this, "DevInstance0" + instanceId, {
          vpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MICRO),
          machineImage: ec2.MachineImage.fromSsmParameter(amis[image].amd64),
          keyName: ecsKeyPair.keyName,
          role:new iam.Role(this, id + 'DeployerSlaveRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
              iam.ManagedPolicy.fromManagedPolicyArn(this, id + 'AdministratorAccess', 'arn:aws:iam::aws:policy/AdministratorAccess'),
            ]
          }),
          blockDevices: [{
            deviceName: '/dev/sda1',
            volume: ec2.BlockDeviceVolume.ebs(8, { deleteOnTermination: true, encrypted: true, volumeType: ec2.EbsDeviceVolumeType.GP2 }),
          }],
          securityGroup: clusterSecurityGroup,
        });
        const ssh = `ssh -i ${ecsKeyPair.keyName}.pem ec2-user@` + instance.instancePublicIp;
        new CfnOutput(this, 'SSH' + instanceId, { value: ssh });
      });
    }

    if (process.env['MYSQL'] === 'true') {
      const credentials = rds.Credentials.fromUsername('root');
      const mysql = new rds.DatabaseCluster(this, 'Mysql', {
        engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_2_03_2 }),
        credentials,

        instanceProps: {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
          vpc,
          vpcSubnets: { subnets },
          securityGroups: [clusterSecurityGroup],
          publiclyAccessible: true,
          deleteAutomatedBackups: true,
        },
        defaultDatabaseName: 'test_db',
        backup: { retention: Duration.days(1) },
        instances: 1,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      new CfnOutput(this, 'MysqlEndpoint', { value: mysql.clusterEndpoint.hostname });
    }
    if (process.env['POSTGRESQL'] === 'true') {
      const credentials = rds.Credentials.fromUsername('root');
      const postgresql = new rds.DatabaseCluster(this, 'Postgresql', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_13_4 }),
        credentials,
        defaultDatabaseName: 'peertube',
        instanceProps: {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
          vpc,
          vpcSubnets: { subnets },
          securityGroups: [clusterSecurityGroup],
          publiclyAccessible: true,
          deleteAutomatedBackups: true,
        },
        backup: { retention: Duration.days(1) },
        instances: 1,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      new CfnOutput(this, 'PostgresqlEndpoint', { value: postgresql.clusterEndpoint.hostname });
    }

  }
}
