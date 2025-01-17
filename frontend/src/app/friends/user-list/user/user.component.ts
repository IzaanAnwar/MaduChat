import { Component, Input, OnInit } from '@angular/core';
import { User } from 'src/app/classes/User';
import { UserService } from 'src/app/services/user.service';
import { MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { SnackbarService } from 'src/app/services/snackbar.service';
import { LanguageService } from 'src/app/services/language.service';


@Component({
  selector: 'user-list-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.scss']
})
export class UserComponent implements OnInit {
  @Input()
  user: User | undefined;

  @Input()
  clientUser: User | undefined;

  isFriend: boolean = false;

  userImage: string = '';

  constructor(private userService: UserService, private snackbar: SnackbarService, private languageService: LanguageService) { }

  ngOnInit() {
    const friendRequestSent = this.clientUser?.friendRequestsSent?.some(user => user.id === this.user?.id);
    const isFriend = this.clientUser?.friends?.some(user => user.id === this.user?.id);
    this.isFriend = friendRequestSent || isFriend || false;
    if (!this.user) return;
    this.userService.getUserProfilePicture(this.user.id).subscribe((image) => {
      this.userImage = image;
    });
  }

  toggleFriendStatus() {
    let snackRef: MatSnackBarRef<TextOnlySnackBar>;
    if (this.isFriend) {
      snackRef = this.snackbar.open(this.languageService.getValue('removedFriendMessage').replace('{username}', `@${this.user?.username}` || ''), this.languageService.getValue('undo'));
      this.userService.removeFriend(<string>this.user?.id).subscribe(user => {
        this.user = user;
      });
    } else {
      snackRef = this.snackbar.open(this.languageService.getValue('addedFriendMessage').replace('{username}', `@${this.user?.username}` || ''), this.languageService.getValue('undo'));
      this.userService.addFriend(<string>this.user?.id).subscribe(user => {
        this.user = user;
      });
    }
    snackRef?.onAction().subscribe(() => {
      this.toggleFriendStatus();
    });
    this.isFriend = !this.isFriend;
  }
}
