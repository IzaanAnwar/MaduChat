import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { User } from './user';
import * as sha256 from 'sha256';
import { Settings } from './settings';
import { Chat } from '../chat/chat';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Chat) private chatRepo: Repository<Chat>,
  ) {}

  async getUser(
    id: string,
    friends?: boolean,
    chats?: boolean,
    settings?: boolean,
  ): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: {
        chats,
        friends,
        settings,
        friendRequestsSent: friends,
        friendRequetsReceived: friends,
      },
    });
    if (!user)
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    return user;
  }

  async getUserLike(
    name: string,
    friends?: boolean,
    chats?: boolean,
    settings?: boolean,
  ): Promise<User[]> {
    if (!name)
      throw new HttpException(
        "Parameter 'like' is required",
        HttpStatus.BAD_REQUEST,
      );
    const users = await this.userRepo.find({
      where: [{ name: Like(`%${name}%`) }, { username: Like(`%${name}%`) }],
      relations: { chats, friends, settings },
      take: 30,
    });
    return users;
  }

  async createUser(user: User): Promise<User> {
    const [dataAlreadyExist, msg] = await this.isDataAlreadyUsed(user);
    if (dataAlreadyExist) {
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
    delete user.id;
    user.password = sha256.x2(user.password);
    user.username = user.username.toLocaleLowerCase();
    const language = user.settings?.language;
    user.settings = new Settings();
    user.settings.language = language || user.settings.language;
    const globalchat = await this.chatRepo.findOne({ where: { id: 'global' } });
    user.chats = [globalchat];
    user = await this.userRepo.save(user);
    delete user.password;
    return user;
  }

  async findOne(id: string): Promise<User | undefined> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findOneByUsernameWithPassword(
    username: string,
  ): Promise<User | undefined> {
    return this.userRepo.findOne({
      where: { username },
      select: { password: true, username: true, id: true },
    });
  }

  async isDataAlreadyUsed(user: User): Promise<[boolean, string]> {
    const userWithSameUsername = await this.userRepo.findOne({
      where: { username: user.username },
    });
    if (userWithSameUsername) return [true, 'Username already exists'];

    const userWithSameEmail = await this.userRepo.findOne({
      where: { email: user.email },
    });
    if (userWithSameEmail) return [true, 'Email already exists'];
    return [false, ''];
  }

  async addFriendRequest(user1Id: string, user2Id: string) {
    if (user2Id === undefined)
      throw new HttpException(`friendId is required`, HttpStatus.BAD_REQUEST);
    const user1 = await this.getUser(user1Id, true);
    const user2 = await this.getUser(user2Id, true);
    if (user1.friendRequestsSent.some(user => user.id === user2.id)) {
      throw new HttpException('Request already sent', HttpStatus.BAD_REQUEST);
    }
    if (user1.id === user2.id) {
      throw new HttpException(
        'You cannot send a friend request to yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (user1.friends.some(user => user.id === user2.id)) {
      throw new HttpException(
        'You cannot send a friend request to a friend',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (user1.friendRequetsReceived.some(user => user.id === user2.id)) {
      return this.addFriend(user1, user2);
    }
    user1.friendRequestsSent.push(user2);
    await this.userRepo.save(user1);
    return user2;
  }

  async addFriend(user1: User, user2: User) {
    user1.friendRequetsReceived = user1.friendRequetsReceived.filter(
      user => user.id !== user2.id,
    );
    user2.friendRequestsSent = user2.friendRequestsSent.filter(
      user => user.id !== user1.id,
    );
    user1.friends.push(user2);
    await this.userRepo.save(user1);
    delete user1.friends;
    delete user1.friendRequestsSent;
    delete user1.friendRequetsReceived;
    user2.friends.push(user1);
    return await this.userRepo.save(user2);
  }

  async removeFriend(user1Id: string, user2Id: string) {
    if (user2Id === undefined)
      throw new HttpException(`friendId is required`, HttpStatus.BAD_REQUEST);
    const user1 = await this.getUser(user1Id, true);
    const user2 = await this.getUser(user2Id, true);
    user1.friendRequestsSent = user1.friendRequestsSent.filter(
      user => user.id !== user2Id,
    );
    user2.friendRequetsReceived = user2.friendRequetsReceived.filter(
      user => user.id !== user1Id,
    );
    user1.friends = user1.friends.filter(user => user.id !== user2Id);
    user2.friends = user2.friends.filter(user => user.id !== user1Id);
    await this.userRepo.save(user1);
    return await this.userRepo.save(user2);
  }

  async changeSettings(id: string, settings: Settings): Promise<User> {
    let user = await this.getUser(id, false, false, true);
    const keys = Object.keys(settings);
    const datas = keys.map(async key => {
      user = await this.changeSetting(user, key, settings[key]);
    });
    const allPromise = Promise.allSettled(datas);
    const statuses = await allPromise;
    if (statuses.some(status => status.status === 'rejected')) {
      throw statuses.find(status => status.status === 'rejected')['reason'];
    }
    return user;
  }

  /**
   * @param user User or UserID
   */
  async changeSetting(
    user: string | User,
    key: string,
    value: any,
  ): Promise<User> {
    user =
      typeof user === 'string'
        ? await this.getUser(user, false, false, true)
        : user;
    if (key === 'id') {
      throw new HttpException(
        `Id change is not allowed`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof user.settings[key] !== typeof value) {
      throw new HttpException(
        `Datatype of '${key}' value is not the same as needed. Is: '${typeof value}' Has to be: '${typeof user
          .settings[key]}'`,
        HttpStatus.BAD_REQUEST,
      );
    }
    user.settings[key] = value;
    return await this.userRepo.save(user);
  }

  async changeProfilePicture(
    userId: string,
    filePath: string,
    response: Response,
  ) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { image: true, id: true },
    });
    if (!user)
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    user.image = filePath;
    await this.userRepo.save(user);
    return await this.getProfilePicture(userId, response);
  }

  async getProfilePicture(id: string, response: Response) {
    const user = await this.userRepo.findOne({
      where: { id },
      select: { image: true },
    });
    if (!user)
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    if (!existsSync(join(process.cwd(), user.image)) || !user.image) {
      throw new HttpException(
        'User has no profile picture',
        HttpStatus.BAD_REQUEST,
      );
    }
    const file = createReadStream(join(process.cwd(), user.image));
    file.pipe(response);
  }

  async deleteProfilePicture(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      select: { image: true, id: true },
    });
    if (!user)
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    user.image = '';
    await this.userRepo.save(user);
  }
}
